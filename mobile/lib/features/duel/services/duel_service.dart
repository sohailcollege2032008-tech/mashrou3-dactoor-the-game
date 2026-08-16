import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:uuid/uuid.dart';
import '../../../core/services/firebase_service.dart';
import '../../../core/services/server_clock_service.dart';
import '../../../core/utils/crypto_utils.dart';
import '../../auth/models/user_profile.dart';
import '../../deck_browser/models/deck_model.dart';
import '../models/duel_model.dart';

class DuelService {
  static DatabaseReference get _duelsRef => FirebaseService.rtdb.ref('duels');

  // Fetch played question texts from Firestore
  static Future<List<String>> fetchPlayedQuestions(String uid, String deckId) async {
    try {
      final snap = await FirebaseService.firestore
          .collection('profiles')
          .doc(uid)
          .collection('played_questions')
          .doc(deckId)
          .get();
      if (snap.exists) {
        final list = snap.data()?['texts'] as List?;
        return list?.map((e) => e.toString()).toList() ?? [];
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  // Record played questions to Firestore
  static Future<void> recordPlayedQuestions(String uid, String deckId, List<String> questionTexts) async {
    if (questionTexts.isEmpty) return;
    try {
      final docRef = FirebaseService.firestore
          .collection('profiles')
          .doc(uid)
          .collection('played_questions')
          .doc(deckId);

      final snap = await docRef.get();
      final existing = snap.exists ? (snap.data()?['texts'] as List? ?? []) : [];
      final merged = {...existing.map((e) => e.toString()), ...questionTexts}.toList();

      await docRef.set({
        'texts': merged,
        'updated_at': FieldValue.serverTimestamp(),
      });
    } catch (_) {}
  }

  // Apply duel configuration (exclude played, shuffle, slice)
  static List<QuestionItem> applyDuelConfig({
    required List<QuestionItem> rawQuestions,
    required Map<String, dynamic> config,
    required List<String> playedTexts,
  }) {
    var questions = List<QuestionItem>.from(rawQuestions);

    final excludePlayed = config['excludePlayed'] == true;
    if (excludePlayed && playedTexts.isNotEmpty) {
      final playedSet = playedTexts.toSet();
      final filtered = questions.where((q) => !playedSet.contains(q.question)).toList();
      if (filtered.length >= 3) {
        questions = filtered;
      }
    }

    final shuffleQuestions = config['shuffleQuestions'] == true ||
        (config['questionCount'] != null && (config['questionCount'] as int) < questions.length);
    if (shuffleQuestions) {
      questions.shuffle();
    }

    final questionCount = config['questionCount'] as int?;
    if (questionCount != null && questionCount < questions.length) {
      questions = questions.sublist(0, questionCount);
    }

    final shuffleAnswers = config['shuffleAnswers'] == true;
    if (shuffleAnswers) {
      questions = questions.map((q) {
        if (q.choices.length < 2) return q;
        final correctText = q.choices[q.correct];
        final shuffledChoices = List<String>.from(q.choices)..shuffle();
        final newCorrectIndex = shuffledChoices.indexOf(correctText);
        return QuestionItem(
          id: q.id,
          question: q.question,
          questionAr: q.questionAr,
          choices: shuffledChoices,
          correct: newCorrectIndex,
          needsImage: q.needsImage,
          imageUrl: q.imageUrl,
        );
      }).toList();
    }

    return questions;
  }

  // Create a new 1v1 duel room
  static Future<String> createDuel({
    required DeckModel deck,
    required UserProfile creator,
    required Map<String, dynamic> config,
  }) async {
    final duelId = const Uuid().v4().substring(0, 8);
    final creatorPlayed = await fetchPlayedQuestions(creator.id, deck.id);

    final preparedQuestions = applyDuelConfig(
      rawQuestions: deck.questions,
      config: config,
      playedTexts: creatorPlayed,
    );

    final duelQuestions = <Map<String, dynamic>>[];
    for (int i = 0; i < preparedQuestions.length; i++) {
      final q = preparedQuestions[i];
      final playedBy = <String>[];
      if (creatorPlayed.contains(q.question)) {
        playedBy.add(creator.id);
      }

      final hash = CryptoUtils.hashCorrectForDuel(duelId, i, q.correct);
      duelQuestions.add({
        'id': q.id,
        'question': q.question,
        'question_ar': q.questionAr,
        'choices': q.choices,
        'correct': q.correct,
        'correct_hash': hash,
        'needs_image': q.needsImage,
        'image_url': q.imageUrl,
        'played_by_uids': playedBy,
      });
    }

    final duelData = {
      'creator_uid': creator.id,
      'deck_id': deck.id,
      'deck_title': deck.title,
      'questions': duelQuestions,
      'total_questions': duelQuestions.length,
      'config': config,
      'force_rtl': deck.forceRtl,
      'status': 'waiting',
      'current_question_index': 0,
      'players': {
        creator.id: {
          'uid': creator.id,
          'nickname': creator.displayName ?? 'الطبيب الأول',
          'avatar_url': creator.avatarUrl,
          'score': 0,
        }
      },
      'created_at': ServerClockService().serverNowMs,
    };

    await _duelsRef.child(duelId).set(duelData);

    // Setup presence
    final presRef = FirebaseService.rtdb.ref('duel_presence/$duelId/${creator.id}');
    await presRef.set({'connected': true});
    presRef.onDisconnect().set({'connected': false});

    return duelId;
  }

  // Join an existing duel
  static Future<void> joinDuel({
    required String duelId,
    required UserProfile joiner,
  }) async {
    final duelSnap = await _duelsRef.child(duelId).get();
    if (!duelSnap.exists) throw Exception('النزال غير موجود أو تم حذفه');

    final data = Map<String, dynamic>.from(duelSnap.value as Map);
    final creatorUid = data['creator_uid'] as String;
    final deckId = data['deck_id'] as String;

    // Add player
    await _duelsRef.child('$duelId/players/${joiner.id}').set({
      'uid': joiner.id,
      'nickname': joiner.displayName ?? 'الطبيب المنافس',
      'avatar_url': joiner.avatarUrl,
      'score': 0,
    });

    // Setup presence
    final presRef = FirebaseService.rtdb.ref('duel_presence/$duelId/${joiner.id}');
    await presRef.set({'connected': true});
    presRef.onDisconnect().set({'connected': false});

    // If joiner is not creator, compute union of played questions
    if (joiner.id != creatorUid) {
      try {
        final creatorPlayed = await fetchPlayedQuestions(creatorUid, deckId);
        final joinerPlayed = await fetchPlayedQuestions(joiner.id, deckId);
        final unionPlayed = {...creatorPlayed, ...joinerPlayed}.toList();

        // Fetch original deck to re-filter if needed
        final deckDoc = await FirebaseService.firestore.collection('question_sets').doc(deckId).get();
        if (deckDoc.exists) {
          final deck = DeckModel.fromFirestore(deckDoc.id, deckDoc.data()!);
          final recomputed = applyDuelConfig(
            rawQuestions: deck.questions,
            config: Map<String, dynamic>.from(data['config'] as Map? ?? {}),
            playedTexts: unionPlayed,
          );

          final updatedDuelQuestions = <Map<String, dynamic>>[];
          for (int i = 0; i < recomputed.length; i++) {
            final q = recomputed[i];
            final playedBy = <String>[];
            if (creatorPlayed.contains(q.question)) playedBy.add(creatorUid);
            if (joinerPlayed.contains(q.question)) playedBy.add(joiner.id);

            final hash = CryptoUtils.hashCorrectForDuel(duelId, i, q.correct);
            updatedDuelQuestions.add({
              'id': q.id,
              'question': q.question,
              'question_ar': q.questionAr,
              'choices': q.choices,
              'correct': q.correct,
              'correct_hash': hash,
              'needs_image': q.needsImage,
              'image_url': q.imageUrl,
              'played_by_uids': playedBy,
            });
          }

          await _duelsRef.child('$duelId/questions').set(updatedDuelQuestions);
          await _duelsRef.child('$duelId/total_questions').set(updatedDuelQuestions.length);
        }
      } catch (_) {}
    }
  }

  // Start the duel
  static Future<void> startDuel(String duelId) async {
    await _duelsRef.child(duelId).update({
      'status': 'playing',
      'current_question_index': 0,
      'question_started_at': ServerClockService().serverNowMs,
    });
  }

  // Submit answer
  static Future<void> submitAnswer({
    required String duelId,
    required int qi,
    required String uid,
    required int? selectedChoice,
    required int reactionTimeMs,
    required bool isCorrect,
    required int pointsEarned,
    bool isForfeit = false,
  }) async {
    final answerData = {
      'uid': uid,
      'selected_choice': selectedChoice,
      'reaction_time_ms': reactionTimeMs,
      'is_correct': isCorrect,
      'points_earned': pointsEarned,
      'is_forfeit': isForfeit,
      'timestamp': ServerClockService().serverNowMs,
    };

    await _duelsRef.child('$duelId/answers/$qi/$uid').set(answerData);

    if (pointsEarned > 0) {
      await _duelsRef.child('$duelId/players/$uid/score').set(ServerValue.increment(pointsEarned));
    }
  }

  // Trigger reveal phase
  static Future<void> triggerReveal(String duelId) async {
    await _duelsRef.child(duelId).update({
      'status': 'revealing',
      'reveal_started_at': ServerClockService().serverNowMs,
    });
  }

  // Advance to next question
  static Future<void> nextQuestion(String duelId, int nextQi) async {
    await _duelsRef.child(duelId).update({
      'status': 'playing',
      'current_question_index': nextQi,
      'question_started_at': ServerClockService().serverNowMs,
    });
  }

  // Finish duel and record history
  static Future<void> finishDuel({
    required DuelModel duel,
    required String myUid,
    String? forfeitBy,
    String? surrenderBy,
  }) async {
    final updates = <String, dynamic>{'status': 'finished'};
    if (forfeitBy != null) updates['forfeit_by'] = forfeitBy;
    if (surrenderBy != null) updates['surrender_by'] = surrenderBy;

    await _duelsRef.child(duel.id).update(updates);

    // Save match history to Firestore for myUid
    try {
      final myPlayer = duel.players[myUid];
      final opponentUid = duel.players.keys.firstWhere((k) => k != myUid, orElse: () => '');
      final oppPlayer = opponentUid.isNotEmpty ? duel.players[opponentUid] : null;

      final myScore = myPlayer?.score ?? 0;
      final oppScore = oppPlayer?.score ?? 0;

      String outcome = 'draw';
      if (forfeitBy != null) {
        outcome = forfeitBy == myUid ? 'lost' : 'won';
      } else if (surrenderBy != null) {
        outcome = 'draw';
      } else if (myScore > oppScore) {
        outcome = 'won';
      } else if (myScore < oppScore) {
        outcome = 'lost';
      }

      await FirebaseService.firestore
          .collection('profiles')
          .doc(myUid)
          .collection('game_history')
          .doc(duel.id)
          .set({
        'duel_id': duel.id,
        'deck_title': duel.deckTitle,
        'opponent_nickname': oppPlayer?.nickname ?? 'منافس',
        'opponent_avatar': oppPlayer?.avatarUrl,
        'my_score': myScore,
        'opponent_score': oppScore,
        'outcome': outcome,
        'played_at': DateTime.now().toIso8601String(),
      });

      // Record questions played by user
      final answeredTexts = duel.questions.map((q) => q.question).toList();
      await recordPlayedQuestions(myUid, duel.deckId, answeredTexts);
    } catch (_) {}
  }
}

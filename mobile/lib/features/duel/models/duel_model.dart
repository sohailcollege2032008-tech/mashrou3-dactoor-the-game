class DuelPlayer {
  final String uid;
  final String nickname;
  final String? avatarUrl;
  final int score;

  DuelPlayer({
    required this.uid,
    required this.nickname,
    this.avatarUrl,
    this.score = 0,
  });

  factory DuelPlayer.fromMap(String uid, Map<String, dynamic> map) {
    return DuelPlayer(
      uid: uid,
      nickname: (map['nickname'] as String?) ?? 'لاعب',
      avatarUrl: map['avatar_url'] as String?,
      score: (map['score'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'uid': uid,
      'nickname': nickname,
      'avatar_url': avatarUrl,
      'score': score,
    };
  }
}

class DuelAnswer {
  final String uid;
  final int? selectedChoice;
  final int reactionTimeMs;
  final bool isCorrect;
  final int pointsEarned;
  final bool isForfeit;

  DuelAnswer({
    required this.uid,
    this.selectedChoice,
    required this.reactionTimeMs,
    required this.isCorrect,
    required this.pointsEarned,
    this.isForfeit = false,
  });

  factory DuelAnswer.fromMap(Map<String, dynamic> map) {
    return DuelAnswer(
      uid: (map['uid'] as String?) ?? '',
      selectedChoice: map['selected_choice'] as int?,
      reactionTimeMs: (map['reaction_time_ms'] as num?)?.toInt() ?? 0,
      isCorrect: map['is_correct'] == true,
      pointsEarned: (map['points_earned'] as num?)?.toInt() ?? 0,
      isForfeit: map['is_forfeit'] == true,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'uid': uid,
      'selected_choice': selectedChoice,
      'reaction_time_ms': reactionTimeMs,
      'is_correct': isCorrect,
      'points_earned': pointsEarned,
      'is_forfeit': isForfeit,
    };
  }
}

class DuelQuestion {
  final int id;
  final String question;
  final String? questionAr;
  final List<String> choices;
  final int? correct;
  final String? correctHash;
  final bool needsImage;
  final String? imageUrl;
  final List<String> playedByUids;

  DuelQuestion({
    required this.id,
    required this.question,
    this.questionAr,
    required this.choices,
    this.correct,
    this.correctHash,
    this.needsImage = false,
    this.imageUrl,
    this.playedByUids = const [],
  });

  factory DuelQuestion.fromMap(int fallbackId, Map<String, dynamic> map) {
    final playedList = (map['played_by_uids'] as List?)?.map((e) => e.toString()).toList() ?? [];
    return DuelQuestion(
      id: (map['id'] as num?)?.toInt() ?? fallbackId,
      question: (map['question'] as String?) ?? '',
      questionAr: map['question_ar'] as String?,
      choices: (map['choices'] as List?)?.map((e) => e.toString()).toList() ?? [],
      correct: map['correct'] as int?,
      correctHash: map['correct_hash'] as String?,
      needsImage: map['needs_image'] == true,
      imageUrl: map['image_url'] as String?,
      playedByUids: playedList,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'question': question,
      'question_ar': questionAr,
      'choices': choices,
      'correct': correct,
      'correct_hash': correctHash,
      'needs_image': needsImage,
      'image_url': imageUrl,
      'played_by_uids': playedByUids,
    };
  }
}

class DuelModel {
  final String id;
  final String creatorUid;
  final String deckId;
  final String deckTitle;
  final List<DuelQuestion> questions;
  final int totalQuestions;
  final Map<String, dynamic> config;
  final bool forceRtl;
  final String status; // 'waiting' | 'playing' | 'revealing' | 'finished'
  final int currentQuestionIndex;
  final int? questionStartedAt;
  final int? revealStartedAt;
  final Map<String, DuelPlayer> players;
  final Map<int, Map<String, DuelAnswer>> answers;
  final String? forfeitBy;
  final String? surrenderBy;

  DuelModel({
    required this.id,
    required this.creatorUid,
    required this.deckId,
    required this.deckTitle,
    required this.questions,
    required this.totalQuestions,
    required this.config,
    this.forceRtl = false,
    this.status = 'waiting',
    this.currentQuestionIndex = 0,
    this.questionStartedAt,
    this.revealStartedAt,
    this.players = const {},
    this.answers = const {},
    this.forfeitBy,
    this.surrenderBy,
  });

  factory DuelModel.fromRTDB(String id, Map<dynamic, dynamic> map) {
    final rawQuestions = map['questions'] as List? ?? [];
    final questions = rawQuestions.asMap().entries.map((e) {
      final qMap = e.value is Map ? Map<String, dynamic>.from(e.value as Map) : <String, dynamic>{};
      return DuelQuestion.fromMap(e.key + 1, qMap);
    }).toList();

    final rawPlayers = map['players'] as Map? ?? {};
    final players = <String, DuelPlayer>{};
    rawPlayers.forEach((k, v) {
      if (v is Map) {
        players[k.toString()] = DuelPlayer.fromMap(k.toString(), Map<String, dynamic>.from(v));
      }
    });

    final rawAnswers = map['answers'] as Map? ?? {};
    final answers = <int, Map<String, DuelAnswer>>{};
    rawAnswers.forEach((qi, ansMap) {
      final qIndex = int.tryParse(qi.toString()) ?? 0;
      if (ansMap is Map) {
        final playerAnswers = <String, DuelAnswer>{};
        ansMap.forEach((uid, aData) {
          if (aData is Map) {
            playerAnswers[uid.toString()] = DuelAnswer.fromMap(Map<String, dynamic>.from(aData));
          }
        });
        answers[qIndex] = playerAnswers;
      }
    });

    return DuelModel(
      id: id,
      creatorUid: (map['creator_uid'] as String?) ?? '',
      deckId: (map['deck_id'] as String?) ?? '',
      deckTitle: (map['deck_title'] as String?) ?? 'نزال طبي',
      questions: questions,
      totalQuestions: (map['total_questions'] as num?)?.toInt() ?? questions.length,
      config: map['config'] is Map ? Map<String, dynamic>.from(map['config'] as Map) : {},
      forceRtl: map['force_rtl'] == true,
      status: (map['status'] as String?) ?? 'waiting',
      currentQuestionIndex: (map['current_question_index'] as num?)?.toInt() ?? 0,
      questionStartedAt: (map['question_started_at'] as num?)?.toInt(),
      revealStartedAt: (map['reveal_started_at'] as num?)?.toInt(),
      players: players,
      answers: answers,
      forfeitBy: map['forfeit_by'] as String?,
      surrenderBy: map['surrender_by'] as String?,
    );
  }
}

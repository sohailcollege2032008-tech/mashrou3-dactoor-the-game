import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/services/firebase_service.dart';
import '../../auth/providers/auth_provider.dart';
import '../models/match_history_item.dart';
import '../models/player_stats.dart';

final playerStatsProvider = FutureProvider.autoDispose<PlayerStats>((ref) async {
  final authState = ref.watch(authNotifierProvider);
  final uid = authState.user?.uid;
  if (uid == null) return const PlayerStats();

  try {
    final historySnap = await FirebaseService.firestore
        .collection('profiles')
        .doc(uid)
        .collection('game_history')
        .get();

    int duelsWon = 0;
    int duelsLost = 0;
    int duelsDrawn = 0;
    int totalPoints = 0;

    for (final doc in historySnap.docs) {
      final data = doc.data();
      final outcome = data['outcome'] as String?;
      final score = (data['my_score'] as num?)?.toInt() ?? 0;
      totalPoints += score;

      if (outcome == 'won') {
        duelsWon++;
      } else if (outcome == 'lost') {
        duelsLost++;
      } else {
        duelsDrawn++;
      }
    }

    final playedQuestionsSnap = await FirebaseService.firestore
        .collection('profiles')
        .doc(uid)
        .collection('played_questions')
        .get();

    int totalQuestions = 0;
    for (final doc in playedQuestionsSnap.docs) {
      final texts = doc.data()['texts'] as List?;
      if (texts != null) totalQuestions += texts.length;
    }

    return PlayerStats(
      duelsPlayed: historySnap.docs.length,
      duelsWon: duelsWon,
      duelsLost: duelsLost,
      duelsDrawn: duelsDrawn,
      totalPoints: totalPoints,
      playedQuestionsCount: totalQuestions,
    );
  } catch (_) {
    return const PlayerStats();
  }
});

final recentMatchesProvider = FutureProvider.autoDispose<List<MatchHistoryItem>>((ref) async {
  final authState = ref.watch(authNotifierProvider);
  final uid = authState.user?.uid;
  if (uid == null) return [];

  try {
    final snap = await FirebaseService.firestore
        .collection('profiles')
        .doc(uid)
        .collection('game_history')
        .orderBy('played_at', descending: true)
        .limit(10)
        .get();

    return snap.docs.map((doc) => MatchHistoryItem.fromMap(doc.id, doc.data())).toList();
  } catch (_) {
    return [];
  }
});

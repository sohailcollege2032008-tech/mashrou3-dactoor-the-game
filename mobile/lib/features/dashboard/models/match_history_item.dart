class MatchHistoryItem {
  final String id;
  final String deckTitle;
  final String opponentNickname;
  final String? opponentAvatar;
  final int myScore;
  final int opponentScore;
  final String outcome; // 'won' | 'lost' | 'draw'
  final DateTime? playedAt;

  const MatchHistoryItem({
    required this.id,
    required this.deckTitle,
    required this.opponentNickname,
    this.opponentAvatar,
    required this.myScore,
    required this.opponentScore,
    required this.outcome,
    this.playedAt,
  });

  factory MatchHistoryItem.fromMap(String id, Map<String, dynamic> map) {
    return MatchHistoryItem(
      id: id,
      deckTitle: (map['deck_title'] as String?) ?? 'تحدي عام',
      opponentNickname: (map['opponent_nickname'] as String?) ?? 'الخصم',
      opponentAvatar: map['opponent_avatar'] as String?,
      myScore: (map['my_score'] as num?)?.toInt() ?? 0,
      opponentScore: (map['opponent_score'] as num?)?.toInt() ?? 0,
      outcome: (map['outcome'] as String?) ?? 'draw',
      playedAt: map['played_at'] != null ? DateTime.tryParse(map['played_at'].toString()) : null,
    );
  }
}

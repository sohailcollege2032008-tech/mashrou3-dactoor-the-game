class TournamentModel {
  final String id;
  final String title;
  final String code;
  final String status; // 'registration' | 'ffa' | 'transition' | 'bracket' | 'finished'
  final String deckId;
  final int maxPlayers;
  final String hostId;
  final DateTime? createdAt;

  TournamentModel({
    required this.id,
    required this.title,
    required this.code,
    required this.status,
    required this.deckId,
    required this.maxPlayers,
    required this.hostId,
    this.createdAt,
  });

  factory TournamentModel.fromFirestore(String id, Map<String, dynamic> map) {
    return TournamentModel(
      id: id,
      title: (map['title'] as String?) ?? 'بطولة طبية',
      code: (map['code'] as String?) ?? '',
      status: (map['status'] as String?) ?? 'registration',
      deckId: (map['deck_id'] as String?) ?? '',
      maxPlayers: (map['max_players'] as num?)?.toInt() ?? 16,
      hostId: (map['host_id'] as String?) ?? '',
      createdAt: map['created_at'] != null ? DateTime.tryParse(map['created_at'].toString()) : null,
    );
  }
}

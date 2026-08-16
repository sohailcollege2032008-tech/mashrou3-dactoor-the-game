import '../../deck_browser/models/deck_model.dart';

class RoomPlayer {
  final String userId;
  final String nickname;
  final String? avatarUrl;
  final int score;
  final int correctCount;
  final int streak;

  RoomPlayer({
    required this.userId,
    required this.nickname,
    this.avatarUrl,
    this.score = 0,
    this.correctCount = 0,
    this.streak = 0,
  });

  factory RoomPlayer.fromMap(String id, Map<dynamic, dynamic> map) {
    return RoomPlayer(
      userId: (map['user_id'] as String?) ?? id,
      nickname: (map['nickname'] as String?) ?? 'لاعب',
      avatarUrl: map['avatar_url'] as String?,
      score: (map['score'] as num?)?.toInt() ?? 0,
      correctCount: (map['correct_count'] as num?)?.toInt() ?? 0,
      streak: (map['streak'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'user_id': userId,
      'nickname': nickname,
      'avatar_url': avatarUrl,
      'score': score,
      'correct_count': correctCount,
      'streak': streak,
    };
  }
}

class HostRoomModel {
  final String code;
  final String hostId;
  final String questionSetId;
  final String title;
  final List<QuestionItem> questions;
  final bool forceRtl;
  final String status; // 'lobby' | 'question' | 'revealing' | 'finished'
  final int currentQuestionIndex;
  final int? questionStartedAt;
  final Map<String, dynamic>? revealData;
  final int timerSeconds;
  final bool autoAccept;
  final Map<String, RoomPlayer> players;

  HostRoomModel({
    required this.code,
    required this.hostId,
    required this.questionSetId,
    required this.title,
    required this.questions,
    this.forceRtl = false,
    this.status = 'lobby',
    this.currentQuestionIndex = 0,
    this.questionStartedAt,
    this.revealData,
    this.timerSeconds = 30,
    this.autoAccept = true,
    this.players = const {},
  });

  factory HostRoomModel.fromRTDB(String code, Map<dynamic, dynamic> map) {
    final questionsObj = map['questions'];
    List<QuestionItem> qList = [];

    if (questionsObj is Map && questionsObj['questions'] is List) {
      final list = questionsObj['questions'] as List;
      qList = list.asMap().entries.map((e) => QuestionItem.fromMap(e.key + 1, Map<String, dynamic>.from(e.value as Map))).toList();
    } else if (questionsObj is List) {
      qList = questionsObj.asMap().entries.map((e) => QuestionItem.fromMap(e.key + 1, Map<String, dynamic>.from(e.value as Map))).toList();
    }

    final rawPlayers = map['players'] as Map? ?? {};
    final players = <String, RoomPlayer>{};
    rawPlayers.forEach((k, v) {
      if (v is Map) {
        players[k.toString()] = RoomPlayer.fromMap(k.toString(), v);
      }
    });

    final config = map['config'] as Map? ?? {};

    return HostRoomModel(
      code: code,
      hostId: (map['host_id'] as String?) ?? '',
      questionSetId: (map['question_set_id'] as String?) ?? '',
      title: (map['title'] as String?) ?? 'مسابقة تفاعلية',
      questions: qList,
      forceRtl: map['force_rtl'] == true,
      status: (map['status'] as String?) ?? 'lobby',
      currentQuestionIndex: (map['current_question_index'] as num?)?.toInt() ?? 0,
      questionStartedAt: (map['question_started_at'] as num?)?.toInt(),
      revealData: map['reveal_data'] is Map ? Map<String, dynamic>.from(map['reveal_data'] as Map) : null,
      timerSeconds: (config['timer_seconds'] as num?)?.toInt() ?? 30,
      autoAccept: (config['auto_accept'] as bool?) ?? true,
      players: players,
    );
  }
}

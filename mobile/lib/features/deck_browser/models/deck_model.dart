class QuestionItem {
  final int id;
  final String question;
  final String? questionAr;
  final List<String> choices;
  final int correct;
  final bool needsImage;
  final String? imageUrl;

  QuestionItem({
    required this.id,
    required this.question,
    this.questionAr,
    required this.choices,
    required this.correct,
    this.needsImage = false,
    this.imageUrl,
  });

  factory QuestionItem.fromMap(int fallbackId, Map<String, dynamic> map) {
    return QuestionItem(
      id: (map['id'] as num?)?.toInt() ?? fallbackId,
      question: (map['question'] as String?) ?? '',
      questionAr: map['question_ar'] as String?,
      choices: (map['choices'] as List?)?.map((e) => e.toString()).toList() ?? [],
      correct: (map['correct'] as num?)?.toInt() ?? 0,
      needsImage: map['needs_image'] == true,
      imageUrl: map['image_url'] as String?,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'question': question,
      'question_ar': questionAr,
      'choices': choices,
      'correct': correct,
      'needs_image': needsImage,
      'image_url': imageUrl,
    };
  }
}

class DeckModel {
  final String id;
  final String hostId;
  final String title;
  final List<QuestionItem> questions;
  final int questionCount;
  final bool isGlobal;
  final List<String> tags;
  final bool forceRtl;
  final DateTime? createdAt;

  DeckModel({
    required this.id,
    required this.hostId,
    required this.title,
    required this.questions,
    required this.questionCount,
    this.isGlobal = true,
    this.tags = const [],
    this.forceRtl = false,
    this.createdAt,
  });

  factory DeckModel.fromFirestore(String id, Map<String, dynamic> map) {
    final questionsObj = map['questions'];
    List<QuestionItem> qList = [];

    if (questionsObj is Map && questionsObj['questions'] is List) {
      final list = questionsObj['questions'] as List;
      qList = list.asMap().entries.map((e) => QuestionItem.fromMap(e.key + 1, e.value as Map<String, dynamic>)).toList();
    } else if (questionsObj is List) {
      qList = questionsObj.asMap().entries.map((e) => QuestionItem.fromMap(e.key + 1, e.value as Map<String, dynamic>)).toList();
    }

    final rawTags = map['tags'] as List?;
    final tags = rawTags?.map((e) => e.toString()).toList() ?? [];

    return DeckModel(
      id: id,
      hostId: (map['host_id'] as String?) ?? '',
      title: (map['title'] as String?) ?? 'بنك أسئلة',
      questions: qList,
      questionCount: (map['question_count'] as num?)?.toInt() ?? qList.length,
      isGlobal: map['is_global'] == true,
      tags: tags,
      forceRtl: map['force_rtl'] == true,
      createdAt: map['created_at'] != null ? DateTime.tryParse(map['created_at'].toString()) : null,
    );
  }
}

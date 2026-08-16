import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:med_royale_mobile/core/services/security_service.dart';
import 'package:med_royale_mobile/features/deck_browser/models/deck_model.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SecurityService Anti-Cheat Tests', () {
    test('SecurityService singleton maintains instance state', () {
      final s1 = SecurityService();
      final s2 = SecurityService();
      expect(identical(s1, s2), isTrue);
    });

    test('Question active callback triggers on lifecycle pause/inactive during active question', () {
      final security = SecurityService();
      bool penaltyTriggered = false;

      security.setQuestionActive(true, callback: (violation, message) {
        if (violation == SecurityViolationType.appBackgrounded) {
          penaltyTriggered = true;
        }
      });

      // Simulate app backgrounded
      security.didChangeAppLifecycleState(AppLifecycleState.paused);

      expect(penaltyTriggered, isTrue);

      // Deactivate question
      penaltyTriggered = false;
      security.setQuestionActive(false);

      // Lifecycle pause should no longer trigger penalty
      security.didChangeAppLifecycleState(AppLifecycleState.paused);
      expect(penaltyTriggered, isFalse);
    });
  });

  group('DeckModel & Question JSON serialization tests', () {
    test('QuestionItem correctly serializes and deserializes', () {
      final map = {
        'id': 42,
        'question': 'What is the powerhouse of the cell?',
        'choices': ['Ribosome', 'Mitochondria', 'Nucleus', 'Golgi'],
        'correct': 1,
        'needs_image': true,
        'image_url': 'https://example.com/cell.png',
      };

      final q = QuestionItem.fromMap(1, map);
      expect(q.id, equals(42));
      expect(q.question, equals('What is the powerhouse of the cell?'));
      expect(q.choices.length, equals(4));
      expect(q.correct, equals(1));
      expect(q.needsImage, isTrue);
      expect(q.imageUrl, equals('https://example.com/cell.png'));

      final outMap = q.toMap();
      expect(outMap['question'], equals('What is the powerhouse of the cell?'));
      expect(outMap['correct'], equals(1));
    });

    test('DeckModel correctly parses Firestore question set document', () {
      final map = {
        'host_id': 'host_123',
        'title': 'Anatomy - Cranial Nerves',
        'is_global': true,
        'force_rtl': false,
        'tags': ['Anatomy', 'Year 1', 'Neuro'],
        'question_count': 10,
        'source_type': 'ai',
        'questions': {
          'questions': [
            {
              'id': 1,
              'question': 'Which nerve is CN VII?',
              'choices': ['Facial', 'Trigeminal', 'Vagus', 'Glossopharyngeal'],
              'correct': 0,
            }
          ]
        }
      };

      final deck = DeckModel.fromFirestore('deck_abc', map);
      expect(deck.id, equals('deck_abc'));
      expect(deck.title, equals('Anatomy - Cranial Nerves'));
      expect(deck.isGlobal, isTrue);
      expect(deck.tags, contains('Neuro'));
      expect(deck.questions.length, equals(1));
      expect(deck.questions.first.question, equals('Which nerve is CN VII?'));
    });
  });
}

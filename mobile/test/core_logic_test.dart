import 'package:flutter_test/flutter_test.dart';
import 'package:med_royale_mobile/core/utils/crypto_utils.dart';
import 'package:med_royale_mobile/core/utils/rtl_utils.dart';
import 'package:med_royale_mobile/features/deck_browser/models/deck_model.dart';
import 'package:med_royale_mobile/features/duel/services/duel_service.dart';

void main() {
  group('CryptoUtils Tests', () {
    test('SHA256 generates consistent deterministic hash', () {
      final h1 = CryptoUtils.sha256Hash('med-royale-test');
      final h2 = CryptoUtils.sha256Hash('med-royale-test');
      expect(h1, equals(h2));
      expect(h1.length, equals(64));
    });

    test('Duel question hashing and matching works correctly', () {
      const duelId = 'test-duel-123';
      const qi = 0;
      const correctIndex = 2;

      final hash = CryptoUtils.hashCorrectForDuel(duelId, qi, correctIndex);
      final found = CryptoUtils.findCorrectForDuel(duelId, qi, 4, hash);

      expect(found, equals(correctIndex));
    });

    test('signAnswer creates valid HMAC signature', () {
      final sig = CryptoUtils.signAnswer(
        selectedChoice: 1,
        reactionTimeMs: 1420,
        timestamp: 1720000000,
        roomId: 'ROOM01',
        userId: 'UID_123',
        questionIndex: 0,
        secretKey: 'my-secret-key',
      );
      expect(sig, isNotEmpty);
      expect(sig.length, equals(64));
    });
  });

  group('RTLUtils Tests', () {
    test('Detects Arabic text correctly', () {
      expect(RTLUtils.hasArabic('ما هو العصب المسؤول عن حركة اللسان؟'), isTrue);
      expect(RTLUtils.hasArabic('What is the cranial nerve responsible for tongue movement?'), isFalse);
    });
  });

  group('Duel Config Application Tests', () {
    final rawQuestions = [
      QuestionItem(id: 1, question: 'Q1', choices: ['A', 'B', 'C', 'D'], correct: 0),
      QuestionItem(id: 2, question: 'Q2', choices: ['A', 'B', 'C', 'D'], correct: 1),
      QuestionItem(id: 3, question: 'Q3', choices: ['A', 'B', 'C', 'D'], correct: 2),
      QuestionItem(id: 4, question: 'Q4', choices: ['A', 'B', 'C', 'D'], correct: 3),
      QuestionItem(id: 5, question: 'Q5', choices: ['A', 'B', 'C', 'D'], correct: 0),
    ];

    test('Excludes played questions when at least 3 remain', () {
      final config = {'excludePlayed': true, 'questionCount': 5};
      final played = ['Q1', 'Q2'];

      final res = DuelService.applyDuelConfig(
        rawQuestions: rawQuestions,
        config: config,
        playedTexts: played,
      );

      expect(res.length, equals(3));
      expect(res.any((q) => q.question == 'Q1'), isFalse);
      expect(res.any((q) => q.question == 'Q2'), isFalse);
    });

    test('Slices to questionCount properly', () {
      final config = {'questionCount': 3};
      final res = DuelService.applyDuelConfig(
        rawQuestions: rawQuestions,
        config: config,
        playedTexts: [],
      );

      expect(res.length, equals(3));
    });
  });
}

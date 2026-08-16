import 'dart:convert';
import 'package:crypto/crypto.dart';

class CryptoUtils {
  static String sha256Hash(String message) {
    final bytes = utf8.encode(message);
    final digest = sha256.convert(bytes);
    return digest.toString();
  }

  static String signAnswer({
    required int? selectedChoice,
    required int reactionTimeMs,
    required int timestamp,
    required String roomId,
    required String userId,
    required int questionIndex,
    required String secretKey,
  }) {
    final data = {
      'selected_choice': selectedChoice,
      'reaction_time': reactionTimeMs,
      'timestamp': timestamp,
      'room_id': roomId,
      'user_id': userId,
      'question_index': questionIndex,
    };

    final message = jsonEncode(data);
    final keyBytes = utf8.encode(secretKey);
    final messageBytes = utf8.encode(message);
    final hmacSha256 = Hmac(sha256, keyBytes);
    final digest = hmacSha256.convert(messageBytes);
    return digest.toString();
  }

  static String hashCorrectForDuel(String duelId, int qi, int correctIndex) {
    return sha256Hash('duel:$duelId:$qi:$correctIndex');
  }

  static int? findCorrectForDuel(String duelId, int qi, int choicesLength, String correctHash) {
    for (int i = 0; i < choicesLength; i++) {
      if (sha256Hash('duel:$duelId:$qi:$i') == correctHash) {
        return i;
      }
    }
    return null;
  }
}

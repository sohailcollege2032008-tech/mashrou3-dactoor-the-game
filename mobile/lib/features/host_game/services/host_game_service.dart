import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_database/firebase_database.dart';
import '../../../core/services/firebase_service.dart';
import '../../../core/services/server_clock_service.dart';
import '../../../core/utils/crypto_utils.dart';
import '../../auth/models/user_profile.dart';

class HostGameService {
  static DatabaseReference get _roomsRef => FirebaseService.rtdb.ref('rooms');

  // Join or request to join a game room
  static Future<Map<String, dynamic>> joinGameRoom({
    required String code,
    required UserProfile player,
  }) async {
    final roomCode = code.toUpperCase().trim();
    final snap = await _roomsRef.child(roomCode).get();

    if (!snap.exists) {
      // Check if it's a tournament code in Firestore
      final tourneySnap = await FirebaseService.firestore
          .collection('tournaments')
          .where('code', isEqualTo: roomCode)
          .get();

      if (tourneySnap.docs.isNotEmpty) {
        final tDoc = tourneySnap.docs.first;
        final tId = tDoc.id;

        // Register player
        await FirebaseService.firestore
            .collection('tournaments')
            .doc(tId)
            .collection('registrations')
            .doc(player.id)
            .set({
          'uid': player.id,
          'nickname': player.displayName ?? 'طبيب',
          'avatar_url': player.avatarUrl,
          'registered_at': FieldValue.serverTimestamp(),
        });

        await FirebaseService.rtdb.ref('tournament_registrations/$tId/${player.id}').set({
          'uid': player.id,
          'nickname': player.displayName ?? 'طبيب',
          'avatar_url': player.avatarUrl,
          'registered_at': ServerClockService().serverNowMs,
        });

        return {'type': 'tournament', 'id': tId};
      }

      throw Exception('كود الغرفة أو البطولة غير صحيح');
    }

    final data = Map<String, dynamic>.from(snap.value as Map);
    if (data['status'] == 'finished') {
      throw Exception('هذه المسابقة انتهت بالفعل');
    }

    final config = data['config'] as Map? ?? {};
    final autoAccept = (config['auto_accept'] as bool?) ?? true;

    if (autoAccept) {
      // Directly add to players
      await _roomsRef.child('$roomCode/players/${player.id}').set({
        'user_id': player.id,
        'nickname': player.displayName ?? 'طبيب',
        'avatar_url': player.avatarUrl,
        'score': 0,
        'correct_count': 0,
        'streak': 0,
      });

      return {'type': 'game_room', 'code': roomCode, 'status': 'accepted'};
    } else {
      // Add to join_requests
      await _roomsRef.child('$roomCode/join_requests/${player.id}').set({
        'user_id': player.id,
        'nickname': player.displayName ?? 'طبيب',
        'avatar_url': player.avatarUrl,
        'status': 'pending',
        'requested_at': ServerClockService().serverNowMs,
      });

      return {'type': 'game_room', 'code': roomCode, 'status': 'pending'};
    }
  }

  // Submit answer in live host game
  static Future<void> submitAnswer({
    required String code,
    required int qi,
    required String uid,
    required int? selectedChoice,
    required int reactionTimeMs,
    required String secretKey,
    bool isForfeit = false,
  }) async {
    final now = ServerClockService().serverNowMs;
    final signature = CryptoUtils.signAnswer(
      selectedChoice: selectedChoice,
      reactionTimeMs: reactionTimeMs,
      timestamp: now,
      roomId: code,
      userId: uid,
      questionIndex: qi,
      secretKey: secretKey,
    );

    final answerData = {
      'user_id': uid,
      'selected_choice': selectedChoice,
      'reaction_time': reactionTimeMs,
      'timestamp': now,
      'signature': signature,
      'is_forfeit': isForfeit,
    };

    await _roomsRef.child('$code/answers/$qi/$uid').set(answerData);
  }
}

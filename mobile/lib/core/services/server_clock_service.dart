import 'package:firebase_database/firebase_database.dart';
import 'firebase_service.dart';

class ServerClockService {
  static final ServerClockService _instance = ServerClockService._internal();
  factory ServerClockService() => _instance;
  ServerClockService._internal();

  int _serverOffsetMs = 0;

  int get offsetMs => _serverOffsetMs;

  void initialize() {
    try {
      FirebaseService.rtdb.ref('.info/serverTimeOffset').onValue.listen((DatabaseEvent event) {
        final val = event.snapshot.value;
        if (val is num) {
          _serverOffsetMs = val.toInt();
        }
      });
    } catch (_) {}
  }

  int get serverNowMs => DateTime.now().millisecondsSinceEpoch + _serverOffsetMs;
  DateTime get serverNow => DateTime.fromMillisecondsSinceEpoch(serverNowMs);
}

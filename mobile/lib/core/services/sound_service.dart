import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class SoundService {
  static final SoundService _instance = SoundService._internal();
  factory SoundService() => _instance;
  SoundService._internal();

  final AudioPlayer _player = AudioPlayer();
  bool _isMuted = false;
  final ValueNotifier<bool> isMutedNotifier = ValueNotifier<bool>(false);

  bool get isMuted => _isMuted;

  Future<void> initialize() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _isMuted = prefs.getBool('sound_muted') ?? false;
      isMutedNotifier.value = _isMuted;
    } catch (_) {}
  }

  Future<void> toggleMute() async {
    _isMuted = !_isMuted;
    isMutedNotifier.value = _isMuted;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('sound_muted', _isMuted);
    } catch (_) {}
  }

  Future<void> _playSound(String assetName) async {
    if (_isMuted) return;
    try {
      await _player.stop();
      await _player.play(AssetSource('sounds/$assetName'));
    } catch (_) {}
  }

  void playCorrect() => _playSound('tada.mp3');
  void playWrong() => _playSound('wrong.mp3');
  void playVictory() => _playSound('victory.mp3');
  void playApplause() => _playSound('applause.mp3');
  void playBoo() => _playSound('boo.mp3');
  void playGasp() => _playSound('gasp.mp3');
  void playTada() => _playSound('tada.mp3');
  void playTick() => _playSound('wrong.mp3');
}

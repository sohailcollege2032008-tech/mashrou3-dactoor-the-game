import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

enum SecurityViolationType {
  appBackgrounded,
  overlayDetected,
  splitScreenDetected,
  windowFocusLost,
}

typedef SecurityViolationCallback = void Function(SecurityViolationType violation, String message);

class SecurityService with WidgetsBindingObserver {
  static final SecurityService _instance = SecurityService._internal();
  factory SecurityService() => _instance;
  SecurityService._internal();

  static const MethodChannel _methodChannel = MethodChannel('com.mashrou3dactoor.med_royale/security_methods');
  static const EventChannel _eventChannel = EventChannel('com.mashrou3dactoor.med_royale/security_events');

  StreamSubscription? _nativeEventSub;
  bool _isMultiWindow = false;
  bool _hasFocus = true;
  bool _isQuestionActive = false;
  bool _shieldActive = false;

  SecurityViolationCallback? onViolation;
  final ValueNotifier<bool> shieldNotifier = ValueNotifier<bool>(false);
  final ValueNotifier<String?> violationNotifier = ValueNotifier<String?>(null);

  bool get isShieldActive => _shieldActive;
  bool get isQuestionActive => _isQuestionActive;

  void initialize() {
    WidgetsBinding.instance.addObserver(this);
    _listenToNativeSecurityEvents();
    enableSecureFlag();
  }

  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _nativeEventSub?.cancel();
  }

  void setQuestionActive(bool active, {SecurityViolationCallback? callback}) {
    _isQuestionActive = active;
    onViolation = callback;
    if (active) {
      violationNotifier.value = null;
    }
  }

  Future<void> enableSecureFlag() async {
    try {
      await _methodChannel.invokeMethod('enableSecureFlag');
    } catch (_) {}
  }

  Future<void> disableSecureFlag() async {
    try {
      await _methodChannel.invokeMethod('disableSecureFlag');
    } catch (_) {}
  }

  void _listenToNativeSecurityEvents() {
    try {
      _nativeEventSub = _eventChannel.receiveBroadcastStream().listen((dynamic event) {
        if (event is Map) {
          final type = event['type'];
          if (type == 'focus_change') {
            final hasFocus = event['hasFocus'] == true;
            _hasFocus = hasFocus;
            if (!hasFocus) {
              _handleViolation(
                SecurityViolationType.windowFocusLost,
                'فقد التطبيق التركيز أو تم فتح تطبيق عائم فوقه',
              );
            } else {
              _checkShieldState();
            }
          } else if (type == 'multi_window_change') {
            final isMulti = event['isMultiWindow'] == true;
            _isMultiWindow = isMulti;
            if (isMulti) {
              _handleViolation(
                SecurityViolationType.splitScreenDetected,
                'تم اكتشاف تقسيم الشاشة، وهو غير مسموح أثناء الاختبار',
              );
            }
            _checkShieldState();
          }
        }
      }, onError: (_) {});
    } catch (_) {}
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive ||
        state == AppLifecycleState.hidden ||
        state == AppLifecycleState.detached) {
      _handleViolation(
        SecurityViolationType.appBackgrounded,
        'تم الخروج من التطبيق أو تصغيره أثناء السؤال',
      );
    }
  }

  void _handleViolation(SecurityViolationType violation, String message) {
    _checkShieldState();

    if (_isQuestionActive) {
      violationNotifier.value = message;
      onViolation?.call(violation, message);
    }
  }

  void _checkShieldState() {
    final shouldShield = _isMultiWindow || (!_hasFocus && _isQuestionActive);
    if (_shieldActive != shouldShield) {
      _shieldActive = shouldShield;
      shieldNotifier.value = shouldShield;
    }
  }
}

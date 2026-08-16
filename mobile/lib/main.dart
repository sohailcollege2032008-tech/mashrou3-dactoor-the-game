import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/router/app_router.dart';
import 'core/services/firebase_service.dart';
import 'core/services/security_service.dart';
import 'core/services/server_clock_service.dart';
import 'core/services/sound_service.dart';
import 'core/theme/app_theme.dart';
import 'core/widgets/security_shield_veil.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize Core Singletons & Services
  await FirebaseService.initialize();
  ServerClockService().initialize();
  await SoundService().initialize();
  SecurityService().initialize();

  runApp(
    const ProviderScope(
      child: MedRoyaleApp(),
    ),
  );
}

class MedRoyaleApp extends StatelessWidget {
  const MedRoyaleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Med Royale',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: ThemeMode.system,
      routerConfig: appRouter,
      builder: (context, child) {
        // Enforce RTL directionality globally with Arabic text and wrap with security shield veil
        return Directionality(
          textDirection: TextDirection.rtl,
          child: SecurityShieldVeil(
            child: child ?? const SizedBox.shrink(),
          ),
        );
      },
    );
  }
}

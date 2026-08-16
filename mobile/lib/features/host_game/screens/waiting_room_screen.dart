import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/services/firebase_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_rule.dart';
import '../../../core/widgets/app_tag.dart';
import '../../auth/providers/auth_provider.dart';

class WaitingRoomScreen extends ConsumerStatefulWidget {
  final String roomId;

  const WaitingRoomScreen({super.key, required this.roomId});

  @override
  ConsumerState<WaitingRoomScreen> createState() => _WaitingRoomScreenState();
}

class _WaitingRoomScreenState extends ConsumerState<WaitingRoomScreen> {
  StreamSubscription? _statusSub;
  StreamSubscription? _playerSub;
  String _roomTitle = 'مسابقة تفاعلية';

  @override
  void initState() {
    super.initState();
    _listenToRoom();
  }

  void _listenToRoom() {
    final uid = ref.read(authNotifierProvider).profile?.id;
    if (uid == null) return;

    final roomCode = widget.roomId.toUpperCase();

    // Listen to room status
    _statusSub = FirebaseService.rtdb.ref('rooms/$roomCode/title').onValue.listen((ev) {
      if (ev.snapshot.value != null) {
        setState(() => _roomTitle = ev.snapshot.value.toString());
      }
    });

    // Listen to player acceptance
    _playerSub = FirebaseService.rtdb.ref('rooms/$roomCode/players/$uid').onValue.listen((ev) {
      if (ev.snapshot.exists) {
        if (mounted) context.go('/player/game/$roomCode');
      }
    });
  }

  @override
  void dispose() {
    _statusSub?.cancel();
    _playerSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(authNotifierProvider).profile;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'غرفة الانتظار',
          style: AppTypography.serif(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: AppCard(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const AppTag(text: 'WAITING LOBBY', variant: AppTagVariant.gold),
                  const SizedBox(height: 16),
                  Text(
                    _roomTitle,
                    textAlign: TextAlign.center,
                    style: AppTypography.arabic(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: isDark ? AppColors.darkInk : AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'كود الغرفة: ${widget.roomId.toUpperCase()}',
                    style: AppTypography.mono(fontSize: 14, fontWeight: FontWeight.w700, color: isDark ? AppColors.darkInk3 : AppColors.ink3),
                  ),
                  const AppRule(variant: AppRuleVariant.standard, margin: EdgeInsets.symmetric(vertical: 20)),
                  CircleAvatar(
                    radius: 36,
                    backgroundColor: AppColors.paper3,
                    backgroundImage: profile?.avatarUrl != null ? NetworkImage(profile!.avatarUrl!) : null,
                    child: profile?.avatarUrl == null ? Text(profile?.displayName?[0] ?? 'P', style: AppTypography.serif(fontSize: 24)) : null,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    profile?.displayName ?? 'الطبيب',
                    style: AppTypography.arabic(fontSize: 16, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 24),
                  const SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2.5),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    'في انتظار بدء المسابقة من المشرف...',
                    textAlign: TextAlign.center,
                    style: AppTypography.arabic(
                      fontSize: 13,
                      color: isDark ? AppColors.darkInk3 : AppColors.ink3,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

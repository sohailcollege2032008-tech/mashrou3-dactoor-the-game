import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/services/firebase_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_rule.dart';
import '../../../core/widgets/app_tag.dart';
import '../../auth/providers/auth_provider.dart';
import '../models/tournament_model.dart';

class TournamentPlayerWaitScreen extends ConsumerStatefulWidget {
  final String tournamentId;

  const TournamentPlayerWaitScreen({super.key, required this.tournamentId});

  @override
  ConsumerState<TournamentPlayerWaitScreen> createState() => _TournamentPlayerWaitScreenState();
}

class _TournamentPlayerWaitScreenState extends ConsumerState<TournamentPlayerWaitScreen> {
  StreamSubscription? _tourneySub;
  TournamentModel? _tournament;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _listenToTournament();
  }

  void _listenToTournament() {
    _tourneySub = FirebaseService.firestore
        .collection('tournaments')
        .doc(widget.tournamentId)
        .snapshots()
        .listen((snap) {
      if (snap.exists && snap.data() != null) {
        setState(() {
          _tournament = TournamentModel.fromFirestore(snap.id, snap.data()!);
          _isLoading = false;
        });
      }
    });
  }

  @override
  void dispose() {
    _tourneySub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final profile = ref.watch(authNotifierProvider).profile;

    if (_isLoading || _tournament == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'انتظار مباريات البطولة',
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
                  const AppTag(text: 'TOURNAMENT LOBBY', variant: AppTagVariant.gold),
                  const SizedBox(height: 14),
                  Text(
                    _tournament!.title,
                    textAlign: TextAlign.center,
                    style: AppTypography.arabic(fontSize: 20, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'كود البطولة: ${_tournament!.code}',
                    style: AppTypography.mono(fontSize: 14, fontWeight: FontWeight.w700),
                  ),
                  const AppRule(variant: AppRuleVariant.standard, margin: EdgeInsets.symmetric(vertical: 20)),
                  CircleAvatar(
                    radius: 32,
                    backgroundColor: AppColors.paper3,
                    backgroundImage: profile?.avatarUrl != null ? NetworkImage(profile!.avatarUrl!) : null,
                    child: profile?.avatarUrl == null ? Text(profile?.displayName?[0] ?? 'P') : null,
                  ),
                  const SizedBox(height: 10),
                  Text(profile?.displayName ?? 'الطبيب', style: AppTypography.arabic(fontSize: 16, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 20),
                  const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2.5)),
                  const SizedBox(height: 14),
                  Text(
                    'الحالة: ${_tournament!.status == "registration" ? "قيد تسجيل اللاعبين" : "جاري تجهيز مباريات الشجرة..."}',
                    style: AppTypography.arabic(fontSize: 13, color: isDark ? AppColors.darkInk3 : AppColors.ink3),
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

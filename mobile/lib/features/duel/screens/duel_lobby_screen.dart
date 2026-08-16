import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import '../../../core/services/firebase_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_rule.dart';
import '../../../core/widgets/app_tag.dart';
import '../../auth/providers/auth_provider.dart';
import '../models/duel_model.dart';
import '../services/duel_service.dart';

class DuelLobbyScreen extends ConsumerStatefulWidget {
  final String duelId;

  const DuelLobbyScreen({super.key, required this.duelId});

  @override
  ConsumerState<DuelLobbyScreen> createState() => _DuelLobbyScreenState();
}

class _DuelLobbyScreenState extends ConsumerState<DuelLobbyScreen> {
  StreamSubscription? _duelSub;
  DuelModel? _duel;
  bool _isLoading = true;
  int? _startCountdown;
  Timer? _countdownTimer;

  @override
  void initState() {
    super.initState();
    _initLobby();
  }

  void _initLobby() async {
    final profile = ref.read(authNotifierProvider).profile;
    if (profile != null) {
      try {
        await DuelService.joinDuel(duelId: widget.duelId, joiner: profile);
      } catch (_) {}
    }

    _duelSub = FirebaseService.rtdb.ref('duels/${widget.duelId}').onValue.listen((event) {
      final val = event.snapshot.value;
      if (val is Map) {
        final duel = DuelModel.fromRTDB(widget.duelId, val);
        setState(() {
          _duel = duel;
          _isLoading = false;
        });

        // If status moved to playing, navigate immediately
        if (duel.status == 'playing') {
          _countdownTimer?.cancel();
          if (mounted) context.go('/duel/game/${widget.duelId}');
        } else if (duel.players.length >= 2 && _startCountdown == null && duel.creatorUid == profile?.id) {
          _startAutoStartCountdown();
        }
      }
    });
  }

  void _startAutoStartCountdown() {
    setState(() => _startCountdown = 5);
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_startCountdown != null && _startCountdown! > 1) {
        setState(() => _startCountdown = _startCountdown! - 1);
      } else {
        timer.cancel();
        DuelService.startDuel(widget.duelId);
      }
    });
  }

  @override
  void dispose() {
    _duelSub?.cancel();
    _countdownTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final myUid = ref.watch(authNotifierProvider).profile?.id;

    if (_isLoading || _duel == null) {
      return Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const CircularProgressIndicator(),
              const SizedBox(height: 16),
              Text('جاري تهيئة غرفة النزال...', style: AppTypography.arabic()),
            ],
          ),
        ),
      );
    }

    final playersList = _duel!.players.values.toList();
    final creator = playersList.firstWhere((p) => p.uid == _duel!.creatorUid, orElse: () => playersList.first);
    final opponent = playersList.firstWhere((p) => p.uid != _duel!.creatorUid, orElse: () => DuelPlayer(uid: '', nickname: ''));
    final hasOpponent = opponent.uid.isNotEmpty;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'غرفة انتظار النزال',
          style: AppTypography.serif(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Deck Title & Badge
              Center(
                child: Column(
                  children: [
                    AppTag(text: '${_duel!.totalQuestions} QUESTIONS', variant: AppTagVariant.burgundy),
                    const SizedBox(height: 8),
                    Text(
                      _duel!.deckTitle,
                      textAlign: TextAlign.center,
                      style: AppTypography.arabic(fontSize: 20, fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
              ),

              const AppRule(variant: AppRuleVariant.thick, margin: EdgeInsets.symmetric(vertical: 16)),

              // Room Code Box
              AppCard(
                variant: AppCardVariant.flat,
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Text('رمز الانضمام للنزال', style: AppTypography.folio(color: isDark ? AppColors.darkInk3 : AppColors.ink3)),
                    const SizedBox(height: 6),
                    SelectableText(
                      widget.duelId.toUpperCase(),
                      style: AppTypography.mono(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: 3),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        AppButton(
                          text: 'نسخ الكود',
                          variant: AppButtonVariant.soft,
                          size: AppButtonSize.sm,
                          icon: const Icon(Icons.copy, size: 14),
                          onPressed: () {
                            Clipboard.setData(ClipboardData(text: widget.duelId));
                            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم نسخ كود النزال!')));
                          },
                        ),
                        const SizedBox(width: 8),
                        AppButton(
                          text: 'مشاركة الرابط',
                          variant: AppButtonVariant.solid,
                          size: AppButtonSize.sm,
                          icon: const Icon(Icons.share, size: 14),
                          onPressed: () {
                            Share.share('تحداني في نزال Med Royale الطبي! كود النزال: ${widget.duelId}\nhttps://medroyale.vercel.app/duel/lobby/${widget.duelId}');
                          },
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 20),

              // QR Code
              Center(
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: AppColors.rule),
                  ),
                  child: QrImageView(
                    data: 'https://medroyale.vercel.app/duel/lobby/${widget.duelId}',
                    version: QrVersions.auto,
                    size: 140.0,
                  ),
                ),
              ),

              const SizedBox(height: 24),

              // Players VS Banner
              Row(
                children: [
                  // Player 1 (Creator)
                  Expanded(
                    child: AppCard(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        children: [
                          CircleAvatar(
                            radius: 24,
                            backgroundColor: AppColors.paper3,
                            backgroundImage: creator.avatarUrl != null ? NetworkImage(creator.avatarUrl!) : null,
                            child: creator.avatarUrl == null ? Text(creator.nickname[0].toUpperCase()) : null,
                          ),
                          const SizedBox(height: 6),
                          Text(creator.nickname, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppTypography.arabic(fontSize: 13, fontWeight: FontWeight.w700)),
                          const SizedBox(height: 2),
                          const AppTag(text: 'CREATOR', variant: AppTagVariant.gold),
                        ],
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    child: Text('VS', style: AppTypography.serif(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.burgundy)),
                  ),
                  // Player 2 (Opponent)
                  Expanded(
                    child: AppCard(
                      padding: const EdgeInsets.all(12),
                      variant: hasOpponent ? AppCardVariant.standard : AppCardVariant.flat,
                      child: hasOpponent
                          ? Column(
                              children: [
                                CircleAvatar(
                                  radius: 24,
                                  backgroundColor: AppColors.paper3,
                                  backgroundImage: opponent.avatarUrl != null ? NetworkImage(opponent.avatarUrl!) : null,
                                  child: opponent.avatarUrl == null ? Text(opponent.nickname[0].toUpperCase()) : null,
                                ),
                                const SizedBox(height: 6),
                                Text(opponent.nickname, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppTypography.arabic(fontSize: 13, fontWeight: FontWeight.w700)),
                                const SizedBox(height: 2),
                                const AppTag(text: 'CHALLENGER', variant: AppTagVariant.navy),
                              ],
                            )
                          : Column(
                              children: [
                                const CircleAvatar(radius: 24, backgroundColor: Colors.transparent, child: Icon(Icons.person_add_outlined, size: 28, color: AppColors.ink4)),
                                const SizedBox(height: 6),
                                Text('في انتظار المنافس...', style: AppTypography.arabic(fontSize: 12, color: isDark ? AppColors.darkInk4 : AppColors.ink4)),
                                const SizedBox(height: 6),
                                const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 1.5)),
                              ],
                            ),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 24),

              // Countdown / Start Button
              if (_startCountdown != null) ...[
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.burgundy.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(color: AppColors.burgundy),
                  ),
                  child: Column(
                    children: [
                      Text('سيبدأ النزال خلال', style: AppTypography.arabic(fontSize: 14, color: AppColors.burgundy)),
                      const SizedBox(height: 4),
                      Text('$_startCountdown', style: AppTypography.mono(fontSize: 36, fontWeight: FontWeight.w800, color: AppColors.burgundy)),
                    ],
                  ),
                ),
              ] else if (hasOpponent && _duel!.creatorUid == myUid) ...[
                AppButton(
                  text: 'بدء النزال الآن ⚔️',
                  variant: AppButtonVariant.solid,
                  size: AppButtonSize.lg,
                  isFullWidth: true,
                  onPressed: () => DuelService.startDuel(widget.duelId),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

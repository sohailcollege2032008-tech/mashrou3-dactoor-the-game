import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/services/firebase_service.dart';
import '../../../core/services/security_service.dart';
import '../../../core/services/server_clock_service.dart';
import '../../../core/services/sound_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_rule.dart';
import '../../../core/widgets/app_tag.dart';
import '../../../core/widgets/math_view.dart';
import '../../../core/widgets/question_image_view.dart';
import '../../auth/providers/auth_provider.dart';
import '../models/host_room_model.dart';
import '../services/host_game_service.dart';

class PlayerGameViewScreen extends ConsumerStatefulWidget {
  final String roomId;

  const PlayerGameViewScreen({super.key, required this.roomId});

  @override
  ConsumerState<PlayerGameViewScreen> createState() => _PlayerGameViewScreenState();
}

class _PlayerGameViewScreenState extends ConsumerState<PlayerGameViewScreen> {
  StreamSubscription? _roomSub;
  HostRoomModel? _room;
  bool _isLoading = true;

  int? _selectedChoice;
  bool _hasAnswered = false;
  int _lastHandledQi = -1;
  String? _securityViolationMsg;

  Timer? _countdownTimer;
  double _timerPct = 1.0;
  int _localQuestionStart = 0;

  @override
  void initState() {
    super.initState();
    _initGameView();
  }

  void _initGameView() {
    final roomCode = widget.roomId.toUpperCase();
    final myUid = ref.read(authNotifierProvider).profile?.id;

    // Security violation handler (app backgrounding / floating app)
    SecurityService().setQuestionActive(true, callback: (v, msg) {
      if (_room?.status == 'question' && !_hasAnswered && myUid != null) {
        _handleSecurityForfeit(msg);
      }
    });

    _roomSub = FirebaseService.rtdb.ref('rooms/$roomCode').onValue.listen((ev) {
      final val = ev.snapshot.value;
      if (val is Map) {
        final room = HostRoomModel.fromRTDB(roomCode, val);
        setState(() {
          _room = room;
          _isLoading = false;
        });

        _syncRoomState(room, myUid);
      }
    });

    _startTimer();
  }

  void _syncRoomState(HostRoomModel room, String? myUid) {
    if (myUid == null) return;

    final qi = room.currentQuestionIndex;
    if (qi != _lastHandledQi) {
      _lastHandledQi = qi;
      _selectedChoice = null;
      _hasAnswered = false;
      _securityViolationMsg = null;
      _localQuestionStart = DateTime.now().millisecondsSinceEpoch;

      SecurityService().setQuestionActive(true, callback: (v, msg) {
        if (_room?.status == 'question' && !_hasAnswered) {
          _handleSecurityForfeit(msg);
        }
      });
    }

    if (room.status == 'revealing') {
      SecurityService().setQuestionActive(false);
      final currentQ = room.questions.isNotEmpty && qi < room.questions.length ? room.questions[qi] : null;
      if (currentQ != null && _selectedChoice != null) {
        if (_selectedChoice == currentQ.correct) {
          SoundService().playCorrect();
        } else {
          SoundService().playWrong();
        }
      }
    } else if (room.status == 'finished') {
      SecurityService().setQuestionActive(false);
      SoundService().playVictory();
    }
  }

  void _handleSecurityForfeit(String msg) {
    if (_hasAnswered || _room == null) return;
    final myUid = ref.read(authNotifierProvider).profile?.id;
    if (myUid == null) return;

    setState(() {
      _hasAnswered = true;
      _selectedChoice = -1;
      _securityViolationMsg = '⚠️ تم إلغاء نقاط هذا السؤال لمغادرة التطبيق أو استخدام تطبيق عائم';
    });

    SoundService().playWrong();

    HostGameService.submitAnswer(
      code: widget.roomId.toUpperCase(),
      qi: _room!.currentQuestionIndex,
      uid: myUid,
      selectedChoice: -1,
      reactionTimeMs: _room!.timerSeconds * 1000,
      secretKey: 'game-secret',
      isForfeit: true,
    );
  }

  void _startTimer() {
    _countdownTimer = Timer.periodic(const Duration(milliseconds: 100), (_) {
      if (_room == null || _room!.status != 'question') return;

      final serverNow = ServerClockService().serverNowMs;
      final startedAt = _room!.questionStartedAt ?? serverNow;
      final totalMs = _room!.timerSeconds * 1000;
      final elapsed = serverNow - startedAt;
      final remaining = totalMs - elapsed;
      final pct = (remaining / totalMs).clamp(0.0, 1.0);

      setState(() => _timerPct = pct);
    });
  }

  void _onChoiceSelected(int index) {
    if (_hasAnswered || _room?.status != 'question') return;

    final myUid = ref.read(authNotifierProvider).profile?.id;
    if (myUid == null || _room == null) return;

    final qi = _room!.currentQuestionIndex;
    final reactionTime = DateTime.now().millisecondsSinceEpoch - _localQuestionStart;

    setState(() {
      _selectedChoice = index;
      _hasAnswered = true;
    });

    HostGameService.submitAnswer(
      code: widget.roomId.toUpperCase(),
      qi: qi,
      uid: myUid,
      selectedChoice: index,
      reactionTimeMs: reactionTime,
      secretKey: 'game-secret',
    );
  }

  @override
  void dispose() {
    _roomSub?.cancel();
    _countdownTimer?.cancel();
    SecurityService().setQuestionActive(false);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final myUid = ref.watch(authNotifierProvider).profile?.id;

    if (_isLoading || _room == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final myPlayer = _room!.players[myUid];

    if (_room!.status == 'lobby') {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const AppTag(text: 'LIVE ROOM', variant: AppTagVariant.navy),
                const SizedBox(height: 12),
                Text(_room!.title, textAlign: TextAlign.center, style: AppTypography.arabic(fontSize: 22, fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                Text('كود الغرفة: ${_room!.code}', style: AppTypography.mono(fontSize: 16, fontWeight: FontWeight.w700)),
                const SizedBox(height: 20),
                const CircularProgressIndicator(),
                const SizedBox(height: 16),
                Text('في انتظار بدء الجولة من المشرف...', style: AppTypography.arabic(fontSize: 14)),
              ],
            ),
          ),
        ),
      );
    }

    if (_room!.status == 'finished') {
      return _buildFinishedPodiumScreen(context);
    }

    final qi = _room!.currentQuestionIndex;
    final currentQ = _room!.questions.isNotEmpty && qi < _room!.questions.length ? _room!.questions[qi] : null;
    final isRevealing = _room!.status == 'revealing';

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // Top Countdown Timer Bar
            Container(
              height: 4,
              color: isDark ? AppColors.darkRule : AppColors.rule,
              alignment: Alignment.centerLeft,
              child: FractionallySizedBox(
                widthFactor: isRevealing ? 0 : _timerPct,
                child: Container(
                  color: _timerPct > 0.5
                      ? (isDark ? AppColors.darkInk : AppColors.ink)
                      : _timerPct > 0.25
                          ? AppColors.gold
                          : AppColors.alert,
                ),
              ),
            ),

            // Top Status Bar: Question Counter & My Score
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  AppTag(text: 'Q ${qi + 1} / ${_room!.questions.length}', variant: AppTagVariant.burgundy),
                  Row(
                    children: [
                      if (myPlayer?.streak != null && myPlayer!.streak > 1)
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: AppTag(text: '🔥 STREAK ${myPlayer.streak}', variant: AppTagVariant.gold),
                        ),
                      Text('${myPlayer?.score ?? 0} PTS', style: AppTypography.mono(fontSize: 15, fontWeight: FontWeight.w800)),
                    ],
                  ),
                ],
              ),
            ),

            if (_securityViolationMsg != null)
              Container(
                color: AppColors.alert,
                padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 16),
                child: Text(
                  _securityViolationMsg!,
                  textAlign: TextAlign.center,
                  style: AppTypography.arabic(fontSize: 12, color: Colors.white, fontWeight: FontWeight.w700),
                ),
              ),

            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (currentQ != null) ...[
                      // Question Card
                      AppCard(
                        padding: const EdgeInsets.all(18),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            MathView(
                              text: currentQ.questionAr ?? currentQ.question,
                              forceRtl: _room!.forceRtl,
                              style: AppTypography.arabic(fontSize: 16, fontWeight: FontWeight.w700, height: 1.4),
                            ),
                            if (currentQ.imageUrl != null) ...[
                              const SizedBox(height: 12),
                              QuestionImageView(imageUrl: currentQ.imageUrl!),
                            ],
                          ],
                        ),
                      ),

                      const SizedBox(height: 16),

                      // Choices (A, B, C, D)
                      ...currentQ.choices.asMap().entries.map((entry) {
                        final cIndex = entry.key;
                        final cText = entry.value;
                        final isSelected = _selectedChoice == cIndex;
                        final isCorrectChoice = cIndex == currentQ.correct;

                        Color borderColor;
                        Color bgColor;
                        Color textColor;

                        if (isRevealing) {
                          if (isCorrectChoice) {
                            borderColor = AppColors.success;
                            bgColor = AppColors.success.withValues(alpha: 0.15);
                            textColor = isDark ? const Color(0xFF67B078) : AppColors.success;
                          } else if (isSelected) {
                            borderColor = AppColors.alert;
                            bgColor = AppColors.alert.withValues(alpha: 0.12);
                            textColor = AppColors.alert;
                          } else {
                            borderColor = isDark ? AppColors.darkRule : AppColors.rule;
                            bgColor = Colors.transparent;
                            textColor = isDark ? AppColors.darkInk4 : AppColors.ink4;
                          }
                        } else {
                          if (isSelected) {
                            borderColor = isDark ? AppColors.darkInk : AppColors.ink;
                            bgColor = (isDark ? AppColors.darkInk : AppColors.ink).withValues(alpha: 0.1);
                            textColor = isDark ? AppColors.darkInk : AppColors.ink;
                          } else {
                            borderColor = isDark ? AppColors.darkRule : AppColors.rule;
                            bgColor = isDark ? AppColors.darkPaper2 : AppColors.paper2;
                            textColor = isDark ? AppColors.darkInk : AppColors.ink;
                          }
                        }

                        final choiceLabels = ['A', 'B', 'C', 'D'];
                        final choiceLabel = cIndex < 4 ? choiceLabels[cIndex] : '${cIndex + 1}';

                        return Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: InkWell(
                            onTap: _hasAnswered ? null : () => _onChoiceSelected(cIndex),
                            borderRadius: BorderRadius.circular(4),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                              decoration: BoxDecoration(
                                color: bgColor,
                                borderRadius: BorderRadius.circular(4),
                                border: Border.all(color: borderColor, width: isSelected || (isRevealing && isCorrectChoice) ? 2 : 1),
                              ),
                              child: Row(
                                children: [
                                  Container(
                                    width: 28,
                                    height: 28,
                                    decoration: BoxDecoration(
                                      color: isRevealing && isCorrectChoice
                                          ? AppColors.success
                                          : isSelected
                                              ? (isDark ? AppColors.darkInk : AppColors.ink)
                                              : Colors.transparent,
                                      shape: BoxShape.circle,
                                      border: Border.all(
                                        color: isRevealing && isCorrectChoice
                                            ? AppColors.success
                                            : isSelected
                                                ? (isDark ? AppColors.darkInk : AppColors.ink)
                                                : (isDark ? AppColors.darkRuleStrong : AppColors.ruleStrong),
                                      ),
                                    ),
                                    child: Center(
                                      child: Text(
                                        choiceLabel,
                                        style: AppTypography.mono(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w700,
                                          color: isSelected || (isRevealing && isCorrectChoice)
                                              ? Colors.white
                                              : (isDark ? AppColors.darkInk : AppColors.ink),
                                        ),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: MathView(
                                      text: cText,
                                      forceRtl: _room!.forceRtl,
                                      style: AppTypography.arabic(
                                        fontSize: 14,
                                        fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                                        color: textColor,
                                      ),
                                    ),
                                  ),
                                  if (isRevealing && isCorrectChoice)
                                    const Icon(Icons.check_circle, color: AppColors.success, size: 20)
                                  else if (isRevealing && isSelected && !isCorrectChoice)
                                    const Icon(Icons.cancel, color: AppColors.alert, size: 20),
                                ],
                              ),
                            ),
                          ),
                        );
                      }),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFinishedPodiumScreen(BuildContext context) {
    final players = _room!.players.values.toList()..sort((a, b) => b.score.compareTo(a.score));
    final myUid = ref.watch(authNotifierProvider).profile?.id;
    final myIndex = players.indexWhere((p) => p.userId == myUid);

    return Scaffold(
      appBar: AppBar(
        title: Text('نهاية المسابقة', style: AppTypography.serif(fontSize: 18, fontWeight: FontWeight.w700)),
        centerTitle: true,
        automaticallyImplyLeading: false,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Column(
                  children: [
                    const Icon(Icons.emoji_events, size: 56, color: AppColors.gold),
                    const SizedBox(height: 8),
                    Text('اكتملت الجولة الحية 🏆', style: AppTypography.arabic(fontSize: 22, fontWeight: FontWeight.w800)),
                    if (myIndex != -1) ...[
                      const SizedBox(height: 6),
                      Text('مرتبتك في الجولة: المركز #${myIndex + 1}', style: AppTypography.arabic(fontSize: 16, color: AppColors.burgundy, fontWeight: FontWeight.w700)),
                      Text('مجموع نقاطك: ${players[myIndex].score} نقطة', style: AppTypography.arabic(fontSize: 14)),
                    ],
                  ],
                ),
              ),
              const AppRule(variant: AppRuleVariant.thick, margin: EdgeInsets.symmetric(vertical: 20)),
              Text('لوحة شرف الأوائل (Leaderboard)', textAlign: TextAlign.right, style: AppTypography.arabic(fontSize: 16, fontWeight: FontWeight.w700)),
              const SizedBox(height: 10),
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: players.take(10).length,
                separatorBuilder: (context, index) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  final p = players[index];
                  final isMe = p.userId == myUid;
                  return AppCard(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    variant: isMe ? AppCardVariant.highlight : AppCardVariant.standard,
                    child: Row(
                      children: [
                        Text(
                          index == 0 ? '🥇 #1' : index == 1 ? '🥈 #2' : index == 2 ? '🥉 #3' : '#${index + 1}',
                          style: AppTypography.mono(fontSize: 14, fontWeight: FontWeight.w800, color: index == 0 ? AppColors.gold : null),
                        ),
                        const SizedBox(width: 12),
                        CircleAvatar(
                          radius: 14,
                          backgroundColor: AppColors.paper3,
                          backgroundImage: p.avatarUrl != null ? NetworkImage(p.avatarUrl!) : null,
                          child: p.avatarUrl == null ? Text(p.nickname[0]) : null,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            p.nickname + (isMe ? ' (أنت)' : ''),
                            style: AppTypography.arabic(fontSize: 14, fontWeight: isMe ? FontWeight.w800 : FontWeight.w500),
                          ),
                        ),
                        Text('${p.score} PTS', style: AppTypography.mono(fontSize: 14, fontWeight: FontWeight.w800)),
                      ],
                    ),
                  );
                },
              ),
              const SizedBox(height: 24),
              AppButton(
                text: 'العودة للرئيسية',
                variant: AppButtonVariant.solid,
                size: AppButtonSize.lg,
                onPressed: () => context.go('/dashboard'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

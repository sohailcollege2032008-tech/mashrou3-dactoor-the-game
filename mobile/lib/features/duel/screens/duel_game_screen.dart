import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/firebase_service.dart';
import '../../../core/services/security_service.dart';
import '../../../core/services/server_clock_service.dart';
import '../../../core/services/sound_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/crypto_utils.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_tag.dart';
import '../../../core/widgets/math_view.dart';
import '../../../core/widgets/question_image_view.dart';
import '../../auth/providers/auth_provider.dart';
import '../models/duel_model.dart';
import '../services/duel_service.dart';

class DuelGameScreen extends ConsumerStatefulWidget {
  final String duelId;

  const DuelGameScreen({super.key, required this.duelId});

  @override
  ConsumerState<DuelGameScreen> createState() => _DuelGameScreenState();
}

class _DuelGameScreenState extends ConsumerState<DuelGameScreen> {
  StreamSubscription? _duelSub;
  StreamSubscription? _presenceSub;
  DuelModel? _duel;
  bool _isLoading = true;

  int? _selectedChoice;
  bool _hasAnswered = false;
  int _lastHandledQi = -1;
  String? _securityViolationMsg;

  Timer? _timerTicker;
  double _timerPct = 1.0;
  int _localQuestionStartTime = 0;
  bool _revealTriggered = false;
  bool _nextTriggered = false;

  bool _opponentConnected = true;
  int? _disconnectCountdown;
  Timer? _disconnectTimer;

  @override
  void initState() {
    super.initState();
    _initGame();
  }

  void _initGame() {
    final myUid = ref.read(authNotifierProvider).profile?.id;

    // Security listener for app backgrounding / floating window cheat detection
    SecurityService().setQuestionActive(true, callback: (violation, msg) {
      if (_duel?.status == 'playing' && !_hasAnswered && myUid != null) {
        _handleSecurityForfeit(msg);
      }
    });

    _duelSub = FirebaseService.rtdb.ref('duels/${widget.duelId}').onValue.listen((event) {
      final val = event.snapshot.value;
      if (val is Map) {
        final duel = DuelModel.fromRTDB(widget.duelId, val);
        setState(() {
          _duel = duel;
          _isLoading = false;
        });

        _syncDuelState(duel, myUid);
      }
    });

    _startTimerTicker();
  }

  void _syncDuelState(DuelModel duel, String? myUid) {
    if (myUid == null) return;

    final qi = duel.currentQuestionIndex;
    if (qi != _lastHandledQi) {
      _lastHandledQi = qi;
      _selectedChoice = null;
      _hasAnswered = false;
      _securityViolationMsg = null;
      _revealTriggered = false;
      _nextTriggered = false;
      _localQuestionStartTime = DateTime.now().millisecondsSinceEpoch;

      SecurityService().setQuestionActive(true, callback: (v, msg) {
        if (_duel?.status == 'playing' && !_hasAnswered) {
          _handleSecurityForfeit(msg);
        }
      });
    }

    // Check if finished
    if (duel.status == 'finished') {
      _finishAndNavigate();
      return;
    }

    // Check opponent presence
    final oppUid = duel.players.keys.firstWhere((k) => k != myUid, orElse: () => '');
    if (oppUid.isNotEmpty && _presenceSub == null) {
      _presenceSub = FirebaseService.rtdb.ref('duel_presence/${widget.duelId}/$oppUid').onValue.listen((ev) {
        final data = ev.snapshot.value;
        final connected = data is Map ? data['connected'] == true : true;
        _handleOpponentPresence(connected, oppUid);
      });
    }

    // Check if both players answered -> early reveal
    if (duel.status == 'playing' && !_revealTriggered && duel.answers[qi] != null) {
      final currentAnswers = duel.answers[qi]!;
      if (currentAnswers.length >= duel.players.length && duel.players.length >= 2) {
        _revealTriggered = true;
        DuelService.triggerReveal(widget.duelId);
      }
    }

    // Handle reveal phase sounds and auto next
    if (duel.status == 'revealing' && !_nextTriggered) {
      SecurityService().setQuestionActive(false);
      final myAnswer = duel.answers[qi]?[myUid];
      if (myAnswer != null) {
        if (myAnswer.isCorrect) {
          SoundService().playCorrect();
        } else {
          SoundService().playWrong();
        }
      }
    }
  }

  void _handleSecurityForfeit(String msg) {
    if (_hasAnswered || _duel == null) return;
    final myUid = ref.read(authNotifierProvider).profile?.id;
    if (myUid == null) return;

    setState(() {
      _hasAnswered = true;
      _selectedChoice = -1;
      _securityViolationMsg = '⚠️ تم إلغاء درجة هذا السؤال ($msg)';
    });

    SoundService().playWrong();

    DuelService.submitAnswer(
      duelId: widget.duelId,
      qi: _duel!.currentQuestionIndex,
      uid: myUid,
      selectedChoice: -1,
      reactionTimeMs: AppConstants.questionDurationMs,
      isCorrect: false,
      pointsEarned: 0,
      isForfeit: true,
    );
  }

  void _startTimerTicker() {
    _timerTicker = Timer.periodic(const Duration(milliseconds: 100), (_) {
      if (_duel == null) return;
      final status = _duel!.status;
      final serverNow = ServerClockService().serverNowMs;

      if (status == 'playing') {
        final startedAt = _duel!.questionStartedAt ?? serverNow;
        final elapsed = serverNow - startedAt;
        final remaining = AppConstants.questionDurationMs - elapsed;
        final pct = (remaining / AppConstants.questionDurationMs).clamp(0.0, 1.0);

        setState(() => _timerPct = pct);

        if (remaining <= 0 && !_revealTriggered) {
          _revealTriggered = true;
          // If user didn't answer in time, record timeout
          final myUid = ref.read(authNotifierProvider).profile?.id;
          if (!_hasAnswered && myUid != null) {
            _hasAnswered = true;
            DuelService.submitAnswer(
              duelId: widget.duelId,
              qi: _duel!.currentQuestionIndex,
              uid: myUid,
              selectedChoice: null,
              reactionTimeMs: AppConstants.questionDurationMs,
              isCorrect: false,
              pointsEarned: 0,
            );
          }
          DuelService.triggerReveal(widget.duelId);
        }
      } else if (status == 'revealing') {
        final revealStart = _duel!.revealStartedAt ?? serverNow;
        final elapsed = serverNow - revealStart;
        if (elapsed >= AppConstants.revealDurationMs && !_nextTriggered) {
          _nextTriggered = true;
          final nextQi = _duel!.currentQuestionIndex + 1;
          if (nextQi < _duel!.totalQuestions) {
            DuelService.nextQuestion(widget.duelId, nextQi);
          } else {
            final myUid = ref.read(authNotifierProvider).profile?.id;
            if (myUid != null) {
              DuelService.finishDuel(duel: _duel!, myUid: myUid);
            }
          }
        }
      }
    });
  }

  void _handleOpponentPresence(bool connected, String oppUid) {
    setState(() => _opponentConnected = connected);
    if (!connected) {
      if (_disconnectTimer != null) return;
      int countdown = AppConstants.forfeitTimeoutSeconds;
      setState(() => _disconnectCountdown = countdown);

      _disconnectTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
        countdown--;
        setState(() => _disconnectCountdown = countdown);
        if (countdown <= 0) {
          timer.cancel();
          final myUid = ref.read(authNotifierProvider).profile?.id;
          if (myUid != null && _duel != null) {
            DuelService.finishDuel(duel: _duel!, myUid: myUid, forfeitBy: oppUid);
          }
        }
      });
    } else {
      _disconnectTimer?.cancel();
      _disconnectTimer = null;
      setState(() => _disconnectCountdown = null);
    }
  }

  void _onChoiceSelected(int index) {
    if (_hasAnswered || _duel?.status != 'playing') return;

    final myUid = ref.read(authNotifierProvider).profile?.id;
    if (myUid == null || _duel == null) return;

    final qi = _duel!.currentQuestionIndex;
    final question = _duel!.questions[qi];
    final reactionTime = DateTime.now().millisecondsSinceEpoch - _localQuestionStartTime;

    // Resolve correctness
    int correctIndex = question.correct ?? 0;
    if (question.correctHash != null) {
      final resolved = CryptoUtils.findCorrectForDuel(widget.duelId, qi, question.choices.length, question.correctHash!);
      if (resolved != null) correctIndex = resolved;
    }

    final isCorrect = index == correctIndex;
    final isRepeated = question.playedByUids.contains(myUid);
    final pointsEarned = isCorrect ? (isRepeated ? 1 : 2) : 0;

    setState(() {
      _selectedChoice = index;
      _hasAnswered = true;
    });

    DuelService.submitAnswer(
      duelId: widget.duelId,
      qi: qi,
      uid: myUid,
      selectedChoice: index,
      reactionTimeMs: reactionTime,
      isCorrect: isCorrect,
      pointsEarned: pointsEarned,
    );
  }

  void _finishAndNavigate() {
    _timerTicker?.cancel();
    _presenceSub?.cancel();
    SecurityService().setQuestionActive(false);
    if (mounted) context.go('/duel/results/${widget.duelId}');
  }

  @override
  void dispose() {
    _timerTicker?.cancel();
    _duelSub?.cancel();
    _presenceSub?.cancel();
    _disconnectTimer?.cancel();
    SecurityService().setQuestionActive(false);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final myUid = ref.watch(authNotifierProvider).profile?.id;

    if (_isLoading || _duel == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final qi = _duel!.currentQuestionIndex;
    final currentQ = _duel!.questions[qi];
    final isRevealing = _duel!.status == 'revealing';

    final myPlayer = _duel!.players[myUid];
    final oppPlayer = _duel!.players.values.firstWhere((p) => p.uid != myUid, orElse: () => DuelPlayer(uid: '', nickname: ''));

    final oppAnswered = _duel!.answers[qi]?[oppPlayer.uid] != null;

    // Resolve correct choice for reveal phase
    int correctChoiceIndex = currentQ.correct ?? 0;
    if (currentQ.correctHash != null) {
      final resolved = CryptoUtils.findCorrectForDuel(widget.duelId, qi, currentQ.choices.length, currentQ.correctHash!);
      if (resolved != null) correctChoiceIndex = resolved;
    }

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // Top Synchronized Timer Bar
            Container(
              height: 4,
              color: isDark ? AppColors.darkRule : AppColors.rule,
              alignment: Alignment.centerLeft,
              child: FractionallySizedBox(
                widthFactor: _timerPct,
                child: Container(
                  color: _timerPct > 0.5
                      ? (isDark ? AppColors.darkInk : AppColors.ink)
                      : _timerPct > 0.25
                          ? AppColors.gold
                          : AppColors.alert,
                ),
              ),
            ),

            // Top Status Bar: Scores, Opponent, Surrender
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Row(
                children: [
                  // My Pill
                  _buildPlayerPill(
                    nickname: myPlayer?.nickname ?? 'أنت',
                    score: myPlayer?.score ?? 0,
                    avatarUrl: myPlayer?.avatarUrl,
                    isMe: true,
                  ),
                  const Spacer(),
                  // Question Counter
                  AppTag(
                    text: 'Q ${qi + 1} / ${_duel!.totalQuestions}',
                    variant: AppTagVariant.burgundy,
                  ),
                  const Spacer(),
                  // Opponent Pill
                  _buildPlayerPill(
                    nickname: oppPlayer.nickname,
                    score: oppPlayer.score,
                    avatarUrl: oppPlayer.avatarUrl,
                    isMe: false,
                    hasAnswered: oppAnswered,
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    icon: const Icon(Icons.flag_outlined, size: 20, color: AppColors.alert),
                    tooltip: 'استسلام / انسحاب',
                    onPressed: _showSurrenderDialog,
                  ),
                ],
              ),
            ),

            if (!_opponentConnected && _disconnectCountdown != null)
              Container(
                color: AppColors.alert,
                padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 16),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.wifi_off, color: Colors.white, size: 16),
                    const SizedBox(width: 8),
                    Text(
                      'انقطع اتصال المنافس — مهلة الانسحاب: $_disconnectCountdown ثانية',
                      style: AppTypography.arabic(fontSize: 12, color: Colors.white, fontWeight: FontWeight.w600),
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
                    // Question Card
                    AppCard(
                      padding: const EdgeInsets.all(18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (currentQ.playedByUids.contains(myUid))
                            const Padding(
                              padding: EdgeInsets.only(bottom: 8),
                              child: Align(
                                alignment: Alignment.topRight,
                                child: AppTag(text: 'سؤال ملعوب سابقاً (+1 نقطة)', variant: AppTagVariant.gold),
                              ),
                            ),
                          MathView(
                            text: currentQ.questionAr ?? currentQ.question,
                            forceRtl: _duel!.forceRtl,
                            style: AppTypography.arabic(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                              height: 1.4,
                              color: isDark ? AppColors.darkInk : AppColors.ink,
                            ),
                          ),
                          if (currentQ.imageUrl != null) ...[
                            const SizedBox(height: 12),
                            QuestionImageView(imageUrl: currentQ.imageUrl!),
                          ],
                        ],
                      ),
                    ),

                    const SizedBox(height: 16),

                    // Choice Buttons (A, B, C, D)
                    ...currentQ.choices.asMap().entries.map((entry) {
                      final cIndex = entry.key;
                      final cText = entry.value;
                      final isSelected = _selectedChoice == cIndex;
                      final isCorrectChoice = cIndex == correctChoiceIndex;

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
                                    forceRtl: _duel!.forceRtl,
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
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPlayerPill({
    required String nickname,
    required int score,
    String? avatarUrl,
    required bool isMe,
    bool hasAnswered = false,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        CircleAvatar(
          radius: 14,
          backgroundColor: AppColors.paper3,
          backgroundImage: avatarUrl != null ? NetworkImage(avatarUrl) : null,
          child: avatarUrl == null ? Text(nickname.isNotEmpty ? nickname[0].toUpperCase() : '?', style: AppTypography.sans(fontSize: 11)) : null,
        ),
        const SizedBox(width: 6),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 80),
                  child: Text(nickname, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppTypography.arabic(fontSize: 11, fontWeight: FontWeight.w600)),
                ),
                if (!isMe && hasAnswered) ...[
                  const SizedBox(width: 4),
                  const Icon(Icons.check, size: 12, color: AppColors.success),
                ],
              ],
            ),
            Text('$score PTS', style: AppTypography.mono(fontSize: 12, fontWeight: FontWeight.w800, color: isDark ? AppColors.darkInk : AppColors.ink)),
          ],
        ),
      ],
    );
  }

  void _showSurrenderDialog() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('هل تريد الاستسلام؟', style: AppTypography.arabic(fontWeight: FontWeight.w700)),
        content: Text('الاستسلام سينهي النزال فورا باحتساب الخسارة.', style: AppTypography.arabic()),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('إلغاء')),
          AppButton(
            text: 'نعم، استسلم',
            variant: AppButtonVariant.alert,
            size: AppButtonSize.sm,
            onPressed: () {
              Navigator.of(ctx).pop();
              final myUid = ref.read(authNotifierProvider).profile?.id;
              if (myUid != null && _duel != null) {
                DuelService.finishDuel(duel: _duel!, myUid: myUid, surrenderBy: myUid);
              }
            },
          ),
        ],
      ),
    );
  }
}

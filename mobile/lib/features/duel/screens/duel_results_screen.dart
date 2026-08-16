import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/services/firebase_service.dart';
import '../../../core/services/sound_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/crypto_utils.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_rule.dart';
import '../../../core/widgets/app_tag.dart';
import '../../../core/widgets/math_view.dart';
import '../../../core/widgets/stat_block.dart';
import '../../auth/providers/auth_provider.dart';
import '../models/duel_model.dart';

class DuelResultsScreen extends ConsumerStatefulWidget {
  final String duelId;

  const DuelResultsScreen({super.key, required this.duelId});

  @override
  ConsumerState<DuelResultsScreen> createState() => _DuelResultsScreenState();
}

class _DuelResultsScreenState extends ConsumerState<DuelResultsScreen> {
  DuelModel? _duel;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadResults();
  }

  void _loadResults() async {
    try {
      final snap = await FirebaseService.rtdb.ref('duels/${widget.duelId}').get();
      if (snap.exists && snap.value is Map) {
        final duel = DuelModel.fromRTDB(widget.duelId, snap.value as Map);
        setState(() {
          _duel = duel;
          _isLoading = false;
        });

        final myUid = ref.read(authNotifierProvider).profile?.id;
        final myScore = duel.players[myUid]?.score ?? 0;
        final oppUid = duel.players.keys.firstWhere((k) => k != myUid, orElse: () => '');
        final oppScore = oppUid.isNotEmpty ? (duel.players[oppUid]?.score ?? 0) : 0;

        if (duel.forfeitBy == myUid) {
          SoundService().playWrong();
        } else if (duel.forfeitBy != null && duel.forfeitBy != myUid) {
          SoundService().playVictory();
        } else if (myScore > oppScore) {
          SoundService().playVictory();
        } else if (myScore < oppScore) {
          SoundService().playWrong();
        }
      }
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final myUid = ref.watch(authNotifierProvider).profile?.id;

    if (_isLoading || _duel == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final myPlayer = _duel!.players[myUid];
    final oppPlayer = _duel!.players.values.firstWhere((p) => p.uid != myUid, orElse: () => DuelPlayer(uid: '', nickname: ''));

    final myScore = myPlayer?.score ?? 0;
    final oppScore = oppPlayer.score;

    String outcomeTitle;
    String outcomeSub;
    Color outcomeColor;

    if (_duel!.forfeitBy == myUid) {
      outcomeTitle = 'هزيمة بالانسحاب';
      outcomeSub = 'تم إنهاء النزال نتيجة خروجك أو استسلامك';
      outcomeColor = AppColors.alert;
    } else if (_duel!.forfeitBy != null && _duel!.forfeitBy != myUid) {
      outcomeTitle = 'فوز بانسحاب الخصم 🏆';
      outcomeSub = 'انسحب الخصم من النزال واحتسب الفوز لصالحك';
      outcomeColor = AppColors.success;
    } else if (myScore > oppScore) {
      outcomeTitle = 'انتصار مستحق 🏆';
      outcomeSub = 'تهانينا! تفوقت على منافسك في النزال الطبي';
      outcomeColor = AppColors.success;
    } else if (myScore < oppScore) {
      outcomeTitle = 'هزيمة ⚔️';
      outcomeSub = 'حاول مجدداً وراجع الأسئلة لتطوير مستواك';
      outcomeColor = AppColors.burgundy;
    } else {
      outcomeTitle = 'تعادل ⚖️';
      outcomeSub = 'أداء متكافئ ونقاط متساوية بين الطبيبين';
      outcomeColor = AppColors.gold;
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'نتيجة النزال',
          style: AppTypography.serif(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        centerTitle: true,
        automaticallyImplyLeading: false,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Outcome Banner
              AppCard(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    Text(
                      outcomeTitle,
                      textAlign: TextAlign.center,
                      style: AppTypography.arabic(
                        fontSize: 24,
                        fontWeight: FontWeight.w800,
                        color: outcomeColor,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      outcomeSub,
                      textAlign: TextAlign.center,
                      style: AppTypography.arabic(
                        fontSize: 13,
                        color: isDark ? AppColors.darkInk3 : AppColors.ink3,
                      ),
                    ),
                    const SizedBox(height: 20),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        StatBlock(
                          label: myPlayer?.nickname ?? 'أنت',
                          value: '$myScore',
                          size: StatValueSize.xl,
                          valueColor: myScore >= oppScore ? AppColors.success : (isDark ? AppColors.darkInk : AppColors.ink),
                          alignment: CrossAxisAlignment.center,
                        ),
                        Text(
                          ':',
                          style: AppTypography.serif(fontSize: 40, fontWeight: FontWeight.w300, color: AppColors.ruleStrong),
                        ),
                        StatBlock(
                          label: oppPlayer.nickname,
                          value: '$oppScore',
                          size: StatValueSize.xl,
                          valueColor: oppScore >= myScore ? AppColors.burgundy : (isDark ? AppColors.darkInk3 : AppColors.ink3),
                          alignment: CrossAxisAlignment.center,
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 16),

              // Action Buttons
              Row(
                children: [
                  Expanded(
                    child: AppButton(
                      text: 'العودة للرئيسية',
                      variant: AppButtonVariant.solid,
                      size: AppButtonSize.md,
                      onPressed: () => context.go('/dashboard'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: AppButton(
                      text: 'تصفح البنوك 📚',
                      variant: AppButtonVariant.ghost,
                      size: AppButtonSize.md,
                      onPressed: () => context.go('/decks'),
                    ),
                  ),
                ],
              ),

              const AppRule(variant: AppRuleVariant.thick, margin: EdgeInsets.symmetric(vertical: 20)),

              // Question Breakdown Section
              Text(
                'مراجعة وتفاصيل الأسئلة',
                textAlign: TextAlign.right,
                style: AppTypography.arabic(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: isDark ? AppColors.darkInk : AppColors.ink,
                ),
              ),
              const SizedBox(height: 10),

              ..._duel!.questions.asMap().entries.map((entry) {
                final qi = entry.key;
                final q = entry.value;
                final myAns = _duel!.answers[qi]?[myUid];

                int correctIndex = q.correct ?? 0;
                if (q.correctHash != null) {
                  final res = CryptoUtils.findCorrectForDuel(widget.duelId, qi, q.choices.length, q.correctHash!);
                  if (res != null) correctIndex = res;
                }

                final isCorrect = myAns?.isCorrect == true;

                return AppCard(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          AppTag(
                            text: isCorrect ? 'إجابة صحيحة ✓' : 'إجابة خاطئة ✗',
                            variant: isCorrect ? AppTagVariant.success : AppTagVariant.alert,
                          ),
                          Text('سؤال ${qi + 1}', style: AppTypography.mono(fontSize: 12, fontWeight: FontWeight.w700)),
                        ],
                      ),
                      const SizedBox(height: 8),
                      MathView(
                        text: q.questionAr ?? q.question,
                        forceRtl: _duel!.forceRtl,
                        style: AppTypography.arabic(fontSize: 14, fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'الإجابة الصحيحة: ${q.choices.isNotEmpty && correctIndex < q.choices.length ? q.choices[correctIndex] : ''}',
                        style: AppTypography.arabic(fontSize: 13, color: AppColors.success, fontWeight: FontWeight.w600),
                      ),
                      if (myAns?.selectedChoice != null && myAns!.selectedChoice! >= 0 && myAns.selectedChoice! < q.choices.length)
                        Text(
                          'إجابتك: ${q.choices[myAns.selectedChoice!]} (${myAns.reactionTimeMs}ms)',
                          style: AppTypography.arabic(
                            fontSize: 12,
                            color: isCorrect ? AppColors.success : AppColors.alert,
                          ),
                        ),
                    ],
                  ),
                );
              }),

              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}

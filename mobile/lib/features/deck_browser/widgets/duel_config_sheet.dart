import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_rule.dart';
import '../../../core/widgets/app_tag.dart';
import '../../auth/providers/auth_provider.dart';
import '../../duel/services/duel_service.dart';
import '../models/deck_model.dart';

class DuelConfigSheet extends ConsumerStatefulWidget {
  final DeckModel deck;

  const DuelConfigSheet({super.key, required this.deck});

  @override
  ConsumerState<DuelConfigSheet> createState() => _DuelConfigSheetState();
}

class _DuelConfigSheetState extends ConsumerState<DuelConfigSheet> {
  int _questionCount = 10;
  bool _excludePlayed = true;
  bool _shuffleQuestions = true;
  bool _shuffleAnswers = true;
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _questionCount = widget.deck.questions.length < 10 ? widget.deck.questions.length : 10;
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final totalAvailable = widget.deck.questions.length;

    return Container(
      decoration: BoxDecoration(
        color: isDark ? AppColors.darkPaper : AppColors.paper,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
        border: Border(top: BorderSide(color: isDark ? AppColors.darkRuleStrong : AppColors.ruleStrong, width: 2)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      child: SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const AppTag(text: 'DUEL CONFIG', variant: AppTagVariant.burgundy),
                  IconButton(
                    icon: const Icon(Icons.close, size: 20),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                widget.deck.title,
                textAlign: TextAlign.right,
                style: AppTypography.arabic(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: isDark ? AppColors.darkInk : AppColors.ink,
                ),
              ),
              Text(
                'إجمالي الأسئلة المتاحة في البنك: $totalAvailable سؤال',
                textAlign: TextAlign.right,
                style: AppTypography.arabic(
                  fontSize: 12,
                  color: isDark ? AppColors.darkInk3 : AppColors.ink3,
                ),
              ),

              const AppRule(variant: AppRuleVariant.standard, margin: EdgeInsets.symmetric(vertical: 14)),

              // Question Count Selector
              Text(
                'عدد الأسئلة في النزال: $_questionCount',
                textAlign: TextAlign.right,
                style: AppTypography.arabic(fontSize: 14, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                children: {5, 10, 15, 20, totalAvailable}.where((n) => n <= totalAvailable).map((count) {
                  final isSelected = _questionCount == count;
                  return ChoiceChip(
                    label: Text('$count أسئلة', style: AppTypography.sans(fontSize: 12, fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500)),
                    selected: isSelected,
                    selectedColor: isDark ? AppColors.darkInk : AppColors.ink,
                    labelStyle: TextStyle(color: isSelected ? (isDark ? AppColors.darkPaper : AppColors.paper) : (isDark ? AppColors.darkInk : AppColors.ink)),
                    onSelected: (val) {
                      if (val) setState(() => _questionCount = count);
                    },
                  );
                }).toList(),
              ),

              const SizedBox(height: 16),

              // Options Switches
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('استبعاد الأسئلة التي لعبتها سابقاً', style: AppTypography.arabic(fontSize: 13, fontWeight: FontWeight.w600)),
                subtitle: Text('لضمان مواجهة أسئلة جديدة غير مكررة', style: AppTypography.arabic(fontSize: 11, color: isDark ? AppColors.darkInk4 : AppColors.ink4)),
                value: _excludePlayed,
                onChanged: (v) => setState(() => _excludePlayed = v),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('خلط ترتيب الأسئلة عشوائياً', style: AppTypography.arabic(fontSize: 13, fontWeight: FontWeight.w600)),
                value: _shuffleQuestions,
                onChanged: (v) => setState(() => _shuffleQuestions = v),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('خلط ترتيب الاختيارات (A/B/C/D)', style: AppTypography.arabic(fontSize: 13, fontWeight: FontWeight.w600)),
                value: _shuffleAnswers,
                onChanged: (v) => setState(() => _shuffleAnswers = v),
              ),

              const SizedBox(height: 20),

              // Create Duel Button
              AppButton(
                text: 'إنشاء غرفة نزال ودعوة صديق',
                variant: AppButtonVariant.solid,
                size: AppButtonSize.lg,
                isFullWidth: true,
                isLoading: _isLoading,
                icon: const Icon(Icons.share_outlined, size: 20),
                onPressed: () async {
                  final profile = ref.read(authNotifierProvider).profile;
                  if (profile == null) return;

                  setState(() => _isLoading = true);
                  try {
                    final duelId = await DuelService.createDuel(
                      deck: widget.deck,
                      creator: profile,
                      config: {
                        'questionCount': _questionCount,
                        'excludePlayed': _excludePlayed,
                        'shuffleQuestions': _shuffleQuestions,
                        'shuffleAnswers': _shuffleAnswers,
                      },
                    );
                    if (context.mounted) {
                      Navigator.of(context).pop();
                      context.push('/duel/lobby/$duelId');
                    }
                  } catch (e) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('فشل في إنشاء النزال: $e')),
                      );
                    }
                  } finally {
                    if (mounted) setState(() => _isLoading = false);
                  }
                },
              ),
              const SizedBox(height: 10),
            ],
          ),
        ),
      ),
    );
  }
}

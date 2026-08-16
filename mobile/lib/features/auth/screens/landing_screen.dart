import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_rule.dart';
import '../../../core/widgets/app_tag.dart';
import '../../../core/widgets/sound_toggle_button.dart';
import '../providers/auth_provider.dart';

class LandingScreen extends ConsumerWidget {
  const LandingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authNotifierProvider);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    // Navigate to dashboard if logged in
    ref.listen<AuthState>(authNotifierProvider, (previous, next) {
      if (next.isAuthenticated && next.profile != null) {
        context.go('/dashboard');
      }
    });

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Header row with folio & sound toggle
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const AppTag(
                    text: 'BATCH 62 • AZHAR MEDICINE',
                    variant: AppTagVariant.navy,
                  ),
                  const SoundToggleButton(),
                ],
              ),

              const SizedBox(height: 28),

              // Brand Title
              Center(
                child: Column(
                  children: [
                    Text(
                      'MED ROYALE',
                      textAlign: TextAlign.center,
                      style: AppTypography.serif(
                        fontSize: 38,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.5,
                        color: isDark ? AppColors.darkInk : AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'مشروع دكتور — منصة التنافس الأكاديمي والنزالات الطبية',
                      textAlign: TextAlign.center,
                      style: AppTypography.arabic(
                        fontSize: 14,
                        color: isDark ? AppColors.darkInk3 : AppColors.ink3,
                      ),
                    ),
                  ],
                ),
              ),

              const AppRule(variant: AppRuleVariant.doubleRule, margin: EdgeInsets.symmetric(vertical: 24)),

              // Login Card
              AppCard(
                variant: AppCardVariant.flat,
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'تسجيل الدخول للمنافسة',
                      textAlign: TextAlign.center,
                      style: AppTypography.arabic(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: isDark ? AppColors.darkInk : AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'سجّل دخولك بحساب Google للمشاركة في النزالات والبطولات وحفظ إحصائياتك.',
                      textAlign: TextAlign.center,
                      style: AppTypography.arabic(
                        fontSize: 13,
                        color: isDark ? AppColors.darkInk3 : AppColors.ink3,
                      ),
                    ),
                    const SizedBox(height: 18),
                    AppButton(
                      text: 'تسجيل الدخول عبر Google',
                      isFullWidth: true,
                      size: AppButtonSize.lg,
                      variant: AppButtonVariant.solid,
                      isLoading: authState.isLoading,
                      icon: const Icon(Icons.g_mobiledata, size: 24),
                      onPressed: () async {
                        await ref.read(authNotifierProvider.notifier).signInWithGoogle();
                      },
                    ),
                    if (authState.errorMessage != null) ...[
                      const SizedBox(height: 12),
                      Text(
                        authState.errorMessage!,
                        textAlign: TextAlign.center,
                        style: AppTypography.arabic(
                          fontSize: 12,
                          color: AppColors.alert,
                        ),
                      ),
                    ],
                  ],
                ),
              ),

              const SizedBox(height: 24),

              // Feature Highlights
              Text(
                'أنظمة اللعب والمنافسة',
                textAlign: TextAlign.right,
                style: AppTypography.arabic(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: isDark ? AppColors.darkInk : AppColors.ink,
                ),
              ),
              const SizedBox(height: 12),

              _buildFeatureItem(
                context,
                icon: Icons.flash_on_outlined,
                title: 'نزالات 1 ضد 1 متزامنة',
                desc: 'تحدَّ زملاءك في مواجهات مباشرة وسريعة مع استبعاد الأسئلة الملعوبة سابقاً.',
                tag: '1V1 DUELS',
                tagVariant: AppTagVariant.burgundy,
              ),
              const SizedBox(height: 10),

              _buildFeatureItem(
                context,
                icon: Icons.groups_outlined,
                title: 'غرف التحدي الجماعية الحية',
                desc: 'انضم لغرفة المشرف بكود اللعبة وتنافس مع الدفعة في الوقت الفعلي.',
                tag: 'LIVE HOST ROOMS',
                tagVariant: AppTagVariant.navy,
              ),
              const SizedBox(height: 10),

              _buildFeatureItem(
                context,
                icon: Icons.emoji_events_outlined,
                title: 'بطولات الإقصاء المباشر',
                desc: 'شارك في دوريات الباتش بنظام الشجرة وتصفيات خروج المغلوب حتى التتويج.',
                tag: 'TOURNAMENTS',
                tagVariant: AppTagVariant.gold,
              ),
              const SizedBox(height: 10),

              _buildFeatureItem(
                context,
                icon: Icons.shield_outlined,
                title: 'حماية ونزاهة ذكية',
                desc: 'نظام حماية يمنع تصوير الشاشة والنوافذ العائمة ويضمن عدالة التنافس.',
                tag: 'ANTI-CHEAT',
                tagVariant: AppTagVariant.success,
              ),

              const SizedBox(height: 32),
              const AppRule(variant: AppRuleVariant.standard),

              // Footer
              Center(
                child: Text(
                  'MED ROYALE • V1.0 • AL-AZHAR UNIVERSITY',
                  style: AppTypography.folio(
                    color: isDark ? AppColors.darkInk4 : AppColors.ink4,
                  ),
                ),
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFeatureItem(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String desc,
    required String tag,
    required AppTagVariant tagVariant,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return AppCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              AppTag(text: tag, variant: tagVariant),
              Icon(icon, size: 20, color: isDark ? AppColors.darkInk2 : AppColors.ink2),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            title,
            textAlign: TextAlign.right,
            style: AppTypography.arabic(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: isDark ? AppColors.darkInk : AppColors.ink,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            desc,
            textAlign: TextAlign.right,
            style: AppTypography.arabic(
              fontSize: 13,
              color: isDark ? AppColors.darkInk3 : AppColors.ink3,
            ),
          ),
        ],
      ),
    );
  }
}

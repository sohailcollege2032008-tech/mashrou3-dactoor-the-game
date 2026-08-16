import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';

class NotAuthorizedScreen extends StatelessWidget {
  const NotAuthorizedScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: AppCard(
              variant: AppCardVariant.flat,
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.lock_outline, size: 48, color: AppColors.burgundy),
                  const SizedBox(height: 16),
                  Text(
                    'غير مصرّح بالدخول',
                    style: AppTypography.arabic(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: isDark ? AppColors.darkInk : AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'ليس لديك الصلاحيات الكافية للوصول إلى هذه الصفحة أو لوحة التحكم.',
                    textAlign: TextAlign.center,
                    style: AppTypography.arabic(
                      fontSize: 14,
                      color: isDark ? AppColors.darkInk3 : AppColors.ink3,
                    ),
                  ),
                  const SizedBox(height: 20),
                  AppButton(
                    text: 'العودة للرئيسية',
                    variant: AppButtonVariant.solid,
                    onPressed: () => context.go('/dashboard'),
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

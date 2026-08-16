import 'package:flutter/material.dart';
import '../services/security_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_typography.dart';

class SecurityShieldVeil extends StatelessWidget {
  final Widget child;

  const SecurityShieldVeil({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        child,
        ValueListenableBuilder<bool>(
          valueListenable: SecurityService().shieldNotifier,
          builder: (context, isShielded, _) {
            if (!isShielded) return const SizedBox.shrink();
            return Positioned.fill(
              child: Container(
                color: Colors.black,
                padding: const EdgeInsets.all(32),
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: AppColors.alert.withValues(alpha: 0.2),
                          border: Border.all(color: AppColors.alert, width: 2),
                        ),
                        child: const Icon(
                          Icons.security_outlined,
                          color: AppColors.alert,
                          size: 48,
                        ),
                      ),
                      const SizedBox(height: 24),
                      Text(
                        '⚠️ الشاشة محجوبة لأسباب أمنية',
                        textAlign: TextAlign.center,
                        style: AppTypography.arabic(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'يُمنع استخدام النوافذ العائمة (Popups/Floating Apps) أو تقسيم الشاشة أثناء حل الأسئلة لحماية نزاهة المسابقة.',
                        textAlign: TextAlign.center,
                        style: AppTypography.arabic(
                          fontSize: 14,
                          fontWeight: FontWeight.w400,
                          color: Colors.white70,
                        ),
                      ),
                      const SizedBox(height: 20),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                        decoration: BoxDecoration(
                          border: Border.all(color: Colors.white24),
                          borderRadius: BorderRadius.circular(4),
                          color: Colors.white10,
                        ),
                        child: Text(
                          'أغلق التطبيق العائم أو أعد التطبيق لملء الشاشة للمتابعة',
                          style: AppTypography.arabic(
                            fontSize: 12,
                            color: Colors.white60,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ],
    );
  }
}

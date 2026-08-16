import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_typography.dart';

enum AppTagVariant { navy, burgundy, gold, success, alert, ghost, filled }

class AppTag extends StatelessWidget {
  final String text;
  final AppTagVariant variant;
  final Widget? icon;
  final VoidCallback? onTap;

  const AppTag({
    super.key,
    required this.text,
    this.variant = AppTagVariant.ghost,
    this.icon,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    Color bg;
    Color fg;
    Color border;

    switch (variant) {
      case AppTagVariant.navy:
        bg = AppColors.navy.withValues(alpha: 0.1);
        fg = isDark ? const Color(0xFF6C8AC0) : AppColors.navy;
        border = fg;
        break;
      case AppTagVariant.burgundy:
        bg = AppColors.burgundy.withValues(alpha: 0.1);
        fg = isDark ? const Color(0xFFE27466) : AppColors.burgundy;
        border = fg;
        break;
      case AppTagVariant.gold:
        bg = AppColors.gold.withValues(alpha: 0.12);
        fg = isDark ? const Color(0xFFD6AB5F) : AppColors.gold;
        border = fg;
        break;
      case AppTagVariant.success:
        bg = AppColors.success.withValues(alpha: 0.1);
        fg = isDark ? const Color(0xFF67B078) : AppColors.success;
        border = fg;
        break;
      case AppTagVariant.alert:
        bg = AppColors.alert.withValues(alpha: 0.1);
        fg = isDark ? const Color(0xFFE86B52) : AppColors.alert;
        border = fg;
        break;
      case AppTagVariant.filled:
        bg = isDark ? AppColors.darkInk : AppColors.ink;
        fg = isDark ? AppColors.darkPaper : AppColors.paper;
        border = bg;
        break;
      case AppTagVariant.ghost:
        bg = isDark ? AppColors.darkPaper2 : AppColors.paper2;
        fg = isDark ? AppColors.darkInk2 : AppColors.ink2;
        border = isDark ? AppColors.darkRule : AppColors.rule;
        break;
    }

    Widget content = Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(2),
        border: Border.all(color: border, width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            icon!,
            const SizedBox(width: 4),
          ],
          Text(
            text,
            style: AppTypography.sans(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: fg,
              letterSpacing: 0.04,
            ),
          ),
        ],
      ),
    );

    if (onTap != null) {
      return GestureDetector(onTap: onTap, child: content);
    }
    return content;
  }
}

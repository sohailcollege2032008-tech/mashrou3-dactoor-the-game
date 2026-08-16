import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

enum AppCardVariant { standard, flat, highlight }

class AppCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;
  final AppCardVariant variant;
  final VoidCallback? onTap;
  final Color? borderColor;

  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.margin,
    this.variant = AppCardVariant.standard,
    this.onTap,
    this.borderColor,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    Color bg;
    switch (variant) {
      case AppCardVariant.standard:
        bg = isDark ? AppColors.darkPaper : AppColors.paper;
        break;
      case AppCardVariant.flat:
        bg = isDark ? AppColors.darkPaper2 : AppColors.paper2;
        break;
      case AppCardVariant.highlight:
        bg = isDark ? AppColors.darkPaper3 : AppColors.paper3;
        break;
    }

    final border = borderColor ?? (isDark ? AppColors.darkRule : AppColors.rule);

    Widget cardWidget = Container(
      margin: margin,
      padding: padding,
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: border, width: 1),
      ),
      child: child,
    );

    if (onTap != null) {
      return InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(4),
        child: cardWidget,
      );
    }

    return cardWidget;
  }
}

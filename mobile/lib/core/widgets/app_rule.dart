import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

enum AppRuleVariant { standard, thick, doubleRule }

class AppRule extends StatelessWidget {
  final AppRuleVariant variant;
  final EdgeInsetsGeometry margin;
  final Color? color;

  const AppRule({
    super.key,
    this.variant = AppRuleVariant.standard,
    this.margin = const EdgeInsets.symmetric(vertical: 12),
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final standardColor = isDark ? AppColors.darkRule : AppColors.rule;
    final strongColor = isDark ? AppColors.darkRuleStrong : AppColors.ruleStrong;

    switch (variant) {
      case AppRuleVariant.standard:
        return Container(
          margin: margin,
          height: 1,
          color: color ?? standardColor,
        );
      case AppRuleVariant.thick:
        return Container(
          margin: margin,
          height: 2,
          color: color ?? strongColor,
        );
      case AppRuleVariant.doubleRule:
        return Container(
          margin: margin,
          height: 5,
          decoration: BoxDecoration(
            border: Border(
              top: BorderSide(color: color ?? strongColor, width: 1.5),
              bottom: BorderSide(color: color ?? strongColor, width: 1.5),
            ),
          ),
        );
    }
  }
}

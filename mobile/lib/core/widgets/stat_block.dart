import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_typography.dart';

enum StatValueSize { sm, md, lg, xl }

class StatBlock extends StatelessWidget {
  final String label;
  final String value;
  final StatValueSize size;
  final Color? valueColor;
  final CrossAxisAlignment alignment;

  const StatBlock({
    super.key,
    required this.label,
    required this.value,
    this.size = StatValueSize.md,
    this.valueColor,
    this.alignment = CrossAxisAlignment.start,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final defaultColor = isDark ? AppColors.darkInk : AppColors.ink;

    double fontSize;
    switch (size) {
      case StatValueSize.sm:
        fontSize = 22;
        break;
      case StatValueSize.md:
        fontSize = 32;
        break;
      case StatValueSize.lg:
        fontSize = 44;
        break;
      case StatValueSize.xl:
        fontSize = 56;
        break;
    }

    return Column(
      crossAxisAlignment: alignment,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label.toUpperCase(),
          style: AppTypography.folio(
            color: isDark ? AppColors.darkInk3 : AppColors.ink3,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: AppTypography.serif(
            fontSize: fontSize,
            fontWeight: FontWeight.w400,
            color: valueColor ?? defaultColor,
            height: 1.1,
          ),
        ),
      ],
    );
  }
}

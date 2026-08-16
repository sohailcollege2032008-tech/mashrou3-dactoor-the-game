import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_typography.dart';

enum AppButtonVariant { solid, ghost, soft, burgundy, navy, alert }
enum AppButtonSize { sm, md, lg }

class AppButton extends StatefulWidget {
  final String text;
  final VoidCallback? onPressed;
  final AppButtonVariant variant;
  final AppButtonSize size;
  final Widget? icon;
  final bool isLoading;
  final bool isFullWidth;

  const AppButton({
    super.key,
    required this.text,
    this.onPressed,
    this.variant = AppButtonVariant.solid,
    this.size = AppButtonSize.md,
    this.icon,
    this.isLoading = false,
    this.isFullWidth = false,
  });

  @override
  State<AppButton> createState() => _AppButtonState();
}

class _AppButtonState extends State<AppButton> {
  bool _isPressed = false;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    Color bg;
    Color fg;
    Color border;

    switch (widget.variant) {
      case AppButtonVariant.solid:
        bg = isDark ? AppColors.darkInk : AppColors.ink;
        fg = isDark ? AppColors.darkPaper : AppColors.paper;
        border = bg;
        break;
      case AppButtonVariant.ghost:
        bg = Colors.transparent;
        fg = isDark ? AppColors.darkInk : AppColors.ink;
        border = fg;
        break;
      case AppButtonVariant.soft:
        bg = isDark ? AppColors.darkPaper2 : AppColors.paper2;
        fg = isDark ? AppColors.darkInk : AppColors.ink;
        border = isDark ? AppColors.darkRule : AppColors.rule;
        break;
      case AppButtonVariant.burgundy:
        bg = AppColors.burgundy;
        fg = Colors.white;
        border = AppColors.burgundy;
        break;
      case AppButtonVariant.navy:
        bg = AppColors.navy;
        fg = Colors.white;
        border = AppColors.navy;
        break;
      case AppButtonVariant.alert:
        bg = AppColors.alert;
        fg = Colors.white;
        border = AppColors.alert;
        break;
    }

    double vPad;
    double hPad;
    double fontSize;

    switch (widget.size) {
      case AppButtonSize.sm:
        vPad = 8;
        hPad = 14;
        fontSize = 12;
        break;
      case AppButtonSize.md:
        vPad = 12;
        hPad = 20;
        fontSize = 14;
        break;
      case AppButtonSize.lg:
        vPad = 16;
        hPad = 28;
        fontSize = 16;
        break;
    }

    Widget content = Row(
      mainAxisSize: widget.isFullWidth ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (widget.isLoading)
          SizedBox(
            width: fontSize,
            height: fontSize,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              valueColor: AlwaysStoppedAnimation<Color>(fg),
            ),
          )
        else ...[
          if (widget.icon != null) ...[
            widget.icon!,
            const SizedBox(width: 8),
          ],
          Text(
            widget.text,
            style: AppTypography.sans(
              fontSize: fontSize,
              fontWeight: FontWeight.w600,
              color: fg,
            ),
          ),
        ],
      ],
    );

    return AnimatedScale(
      scale: _isPressed ? 0.96 : 1.0,
      duration: const Duration(milliseconds: 120),
      child: GestureDetector(
        onTapDown: (_) => setState(() => _isPressed = true),
        onTapUp: (_) => setState(() => _isPressed = false),
        onTapCancel: () => setState(() => _isPressed = false),
        onTap: widget.isLoading ? null : widget.onPressed,
        child: Container(
          width: widget.isFullWidth ? double.infinity : null,
          padding: EdgeInsets.symmetric(vertical: vPad, horizontal: hPad),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: border, width: 1),
          ),
          child: content,
        ),
      ),
    );
  }
}

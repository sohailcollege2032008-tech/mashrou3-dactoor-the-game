import 'package:flutter/material.dart';
import 'package:flutter_math_fork/flutter_math.dart';
import '../theme/app_typography.dart';
import '../utils/rtl_utils.dart';

class MathView extends StatelessWidget {
  final String text;
  final TextStyle? style;
  final TextAlign? textAlign;
  final bool forceRtl;

  const MathView({
    super.key,
    required this.text,
    this.style,
    this.textAlign,
    this.forceRtl = false,
  });

  @override
  Widget build(BuildContext context) {
    if (text.isEmpty) return const SizedBox.shrink();

    // Check for LaTeX math delimiters: $...$ or $$...$$
    final mathRegex = RegExp(r'\$([^\$]+)\$');
    if (!mathRegex.hasMatch(text)) {
      final isAr = RTLUtils.hasArabic(text) || forceRtl;
      return Text(
        text,
        textAlign: textAlign ?? (isAr ? TextAlign.right : TextAlign.left),
        textDirection: isAr ? TextDirection.rtl : TextDirection.ltr,
        style: style ?? (isAr ? AppTypography.arabic() : AppTypography.sans()),
      );
    }

    final spans = <InlineSpan>[];
    int lastIndex = 0;

    for (final match in mathRegex.allMatches(text)) {
      if (match.start > lastIndex) {
        final plain = text.substring(lastIndex, match.start);
        spans.add(TextSpan(
          text: plain,
          style: style ?? (RTLUtils.hasArabic(plain) ? AppTypography.arabic() : AppTypography.sans()),
        ));
      }

      final mathContent = match.group(1) ?? '';
      spans.add(WidgetSpan(
        alignment: PlaceholderAlignment.middle,
        child: Math.tex(
          mathContent,
          textStyle: style,
          mathStyle: MathStyle.text,
          onErrorFallback: (err) => Text(
            '\$$mathContent\$',
            style: style,
          ),
        ),
      ));

      lastIndex = match.end;
    }

    if (lastIndex < text.length) {
      final plain = text.substring(lastIndex);
      spans.add(TextSpan(
        text: plain,
        style: style ?? (RTLUtils.hasArabic(plain) ? AppTypography.arabic() : AppTypography.sans()),
      ));
    }

    final isAr = RTLUtils.hasArabic(text) || forceRtl;
    return Text.rich(
      TextSpan(children: spans),
      textAlign: textAlign ?? (isAr ? TextAlign.right : TextAlign.left),
      textDirection: isAr ? TextDirection.rtl : TextDirection.ltr,
    );
  }
}

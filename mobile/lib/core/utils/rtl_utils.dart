import 'package:flutter/material.dart';

class RTLUtils {
  static bool hasArabic(String? text) {
    if (text == null || text.isEmpty) return false;
    return RegExp(r'[\u0600-\u06FF]').hasMatch(text);
  }

  static TextDirection getDirection(String? text, {bool forceRtl = false}) {
    if (forceRtl) return TextDirection.rtl;
    return hasArabic(text) ? TextDirection.rtl : TextDirection.ltr;
  }

  static TextAlign getTextAlign(String? text, {bool forceRtl = false}) {
    if (forceRtl) return TextAlign.right;
    return hasArabic(text) ? TextAlign.right : TextAlign.left;
  }
}

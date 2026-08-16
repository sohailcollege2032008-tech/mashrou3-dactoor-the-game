import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'app_colors.dart';

class AppTypography {
  static TextStyle serif({
    double fontSize = 16,
    FontWeight fontWeight = FontWeight.w400,
    Color? color,
    double? height,
    double? letterSpacing,
  }) {
    return GoogleFonts.fraunces(
      fontSize: fontSize,
      fontWeight: fontWeight,
      color: color ?? AppColors.ink,
      height: height,
      letterSpacing: letterSpacing ?? -0.01,
    );
  }

  static TextStyle arabic({
    double fontSize = 15,
    FontWeight fontWeight = FontWeight.w500,
    Color? color,
    double? height,
    double? letterSpacing,
  }) {
    return GoogleFonts.ibmPlexSansArabic(
      fontSize: fontSize,
      fontWeight: fontWeight,
      color: color ?? AppColors.ink,
      height: height ?? 1.4,
      letterSpacing: letterSpacing,
    );
  }

  static TextStyle sans({
    double fontSize = 14,
    FontWeight fontWeight = FontWeight.w500,
    Color? color,
    double? height,
    double? letterSpacing,
  }) {
    return GoogleFonts.interTight(
      fontSize: fontSize,
      fontWeight: fontWeight,
      color: color ?? AppColors.ink,
      height: height,
      letterSpacing: letterSpacing,
    );
  }

  static TextStyle mono({
    double fontSize = 12,
    FontWeight fontWeight = FontWeight.w600,
    Color? color,
    double? height,
    double? letterSpacing,
  }) {
    return GoogleFonts.jetBrainsMono(
      fontSize: fontSize,
      fontWeight: fontWeight,
      color: color ?? AppColors.ink,
      height: height,
      letterSpacing: letterSpacing ?? 0.08,
    );
  }

  static TextStyle folio({Color? color}) {
    return GoogleFonts.jetBrainsMono(
      fontSize: 10,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.15,
      color: color ?? AppColors.ink3,
    );
  }
}

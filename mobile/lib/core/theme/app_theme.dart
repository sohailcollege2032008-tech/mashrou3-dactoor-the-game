import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'app_colors.dart';

class AppTheme {
  static ThemeData lightTheme = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: AppColors.paper,
    cardColor: AppColors.paper,
    dividerColor: AppColors.rule,
    colorScheme: const ColorScheme.light(
      primary: AppColors.ink,
      secondary: AppColors.burgundy,
      tertiary: AppColors.navy,
      surface: AppColors.paper,
      error: AppColors.alert,
      onPrimary: AppColors.paper,
      onSecondary: AppColors.paper,
      onSurface: AppColors.ink,
      onError: Colors.white,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.paper,
      foregroundColor: AppColors.ink,
      elevation: 0,
      systemOverlayStyle: SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
      ),
    ),
  );

  static ThemeData darkTheme = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: AppColors.darkPaper,
    cardColor: AppColors.darkPaper2,
    dividerColor: AppColors.darkRule,
    colorScheme: const ColorScheme.dark(
      primary: AppColors.darkInk,
      secondary: AppColors.burgundy,
      tertiary: AppColors.navy,
      surface: AppColors.darkPaper,
      error: AppColors.alert,
      onPrimary: AppColors.darkPaper,
      onSecondary: AppColors.darkInk,
      onSurface: AppColors.darkInk,
      onError: Colors.white,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.darkPaper,
      foregroundColor: AppColors.darkInk,
      elevation: 0,
      systemOverlayStyle: SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
      ),
    ),
  );
}

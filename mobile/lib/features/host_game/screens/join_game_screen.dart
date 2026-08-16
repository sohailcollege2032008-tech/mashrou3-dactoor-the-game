import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_rule.dart';
import '../../../core/widgets/app_tag.dart';
import '../../auth/providers/auth_provider.dart';
import '../services/host_game_service.dart';

class JoinGameScreen extends ConsumerStatefulWidget {
  const JoinGameScreen({super.key});

  @override
  ConsumerState<JoinGameScreen> createState() => _JoinGameScreenState();
}

class _JoinGameScreenState extends ConsumerState<JoinGameScreen> {
  final TextEditingController _codeController = TextEditingController();
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  void _handleJoin() async {
    final code = _codeController.text.trim().toUpperCase();
    if (code.length != 6) {
      setState(() => _errorMessage = 'يرجى إدخال رمز مكون من 6 أحرف أو أرقام');
      return;
    }

    final profile = ref.read(authNotifierProvider).profile;
    if (profile == null) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final res = await HostGameService.joinGameRoom(code: code, player: profile);
      if (!mounted) return;

      if (res['type'] == 'tournament') {
        context.push('/tournament/${res['id']}/wait');
      } else if (res['status'] == 'accepted') {
        context.push('/player/game/$code');
      } else {
        context.push('/player/waiting/$code');
      }
    } catch (e) {
      if (mounted) {
        setState(() => _errorMessage = e.toString().replaceAll('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'الانضمام لمسابقة',
          style: AppTypography.serif(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: AppCard(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Center(
                    child: AppTag(text: 'LIVE ROOM / TOURNAMENT', variant: AppTagVariant.navy),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'أدخل رمز الغرفة (PIN)',
                    textAlign: TextAlign.center,
                    style: AppTypography.arabic(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: isDark ? AppColors.darkInk : AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'ادخل الرمز المكون من 6 خانات المعروض على شاشة المشرف أو منظم البطولة.',
                    textAlign: TextAlign.center,
                    style: AppTypography.arabic(
                      fontSize: 13,
                      color: isDark ? AppColors.darkInk3 : AppColors.ink3,
                    ),
                  ),

                  const AppRule(variant: AppRuleVariant.standard, margin: EdgeInsets.symmetric(vertical: 18)),

                  // PIN Input Field
                  TextField(
                    controller: _codeController,
                    textAlign: TextAlign.center,
                    textCapitalization: TextCapitalization.characters,
                    maxLength: 6,
                    style: AppTypography.mono(
                      fontSize: 32,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 8,
                      color: isDark ? AppColors.darkInk : AppColors.ink,
                    ),
                    decoration: InputDecoration(
                      hintText: '••••••',
                      counterText: '',
                      filled: true,
                      fillColor: isDark ? AppColors.darkPaper2 : AppColors.paper2,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(4),
                        borderSide: BorderSide(color: isDark ? AppColors.darkRuleStrong : AppColors.ruleStrong, width: 1.5),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(4),
                        borderSide: BorderSide(color: isDark ? AppColors.darkInk : AppColors.ink, width: 2),
                      ),
                    ),
                    onSubmitted: (_) => _handleJoin(),
                  ),

                  if (_errorMessage != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _errorMessage!,
                      textAlign: TextAlign.center,
                      style: AppTypography.arabic(fontSize: 13, color: AppColors.alert, fontWeight: FontWeight.w600),
                    ),
                  ],

                  const SizedBox(height: 20),

                  AppButton(
                    text: 'دخول المسابقة الآن 🎮',
                    variant: AppButtonVariant.solid,
                    size: AppButtonSize.lg,
                    isFullWidth: true,
                    isLoading: _isLoading,
                    onPressed: _handleJoin,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/services/firebase_service.dart';
import '../../../core/services/server_clock_service.dart';
import '../../../core/services/sound_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_rule.dart';
import '../../../core/widgets/app_tag.dart';
import '../../../core/widgets/math_view.dart';
import '../../host_game/models/host_room_model.dart';

class HostGameRoomScreen extends ConsumerStatefulWidget {
  final String roomId;

  const HostGameRoomScreen({super.key, required this.roomId});

  @override
  ConsumerState<HostGameRoomScreen> createState() => _HostGameRoomScreenState();
}

class _HostGameRoomScreenState extends ConsumerState<HostGameRoomScreen> {
  StreamSubscription? _roomSub;
  HostRoomModel? _room;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _listenToRoom();
  }

  void _listenToRoom() {
    final roomCode = widget.roomId.toUpperCase();
    _roomSub = FirebaseService.rtdb.ref('rooms/$roomCode').onValue.listen((ev) {
      final val = ev.snapshot.value;
      if (val is Map) {
        setState(() {
          _room = HostRoomModel.fromRTDB(roomCode, val);
          _isLoading = false;
        });
      }
    });
  }

  Future<void> _startFirstQuestion() async {
    final roomCode = widget.roomId.toUpperCase();
    await FirebaseService.rtdb.ref('rooms/$roomCode').update({
      'status': 'question',
      'current_question_index': 0,
      'question_started_at': ServerClockService().serverNowMs,
    });
  }

  Future<void> _revealAnswer() async {
    final roomCode = widget.roomId.toUpperCase();
    await FirebaseService.rtdb.ref('rooms/$roomCode').update({
      'status': 'revealing',
      'reveal_started_at': ServerClockService().serverNowMs,
    });
    SoundService().playCorrect();
  }

  Future<void> _nextQuestion() async {
    if (_room == null) return;
    final roomCode = widget.roomId.toUpperCase();
    final nextQi = _room!.currentQuestionIndex + 1;

    if (nextQi < _room!.questions.length) {
      await FirebaseService.rtdb.ref('rooms/$roomCode').update({
        'status': 'question',
        'current_question_index': nextQi,
        'question_started_at': ServerClockService().serverNowMs,
      });
    } else {
      await FirebaseService.rtdb.ref('rooms/$roomCode').update({
        'status': 'finished',
      });
      SoundService().playVictory();
    }
  }

  @override
  void dispose() {
    _roomSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    if (_isLoading || _room == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'غرفة التحكم: ${_room!.code}',
          style: AppTypography.serif(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        centerTitle: true,
        actions: [
          IconButton(
            icon: const Icon(Icons.exit_to_app),
            onPressed: () => context.go('/dashboard'),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Room Code Box
              AppCard(
                variant: AppCardVariant.flat,
                padding: const EdgeInsets.all(16),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('رمز الانضمام (PIN)', style: AppTypography.folio(color: isDark ? AppColors.darkInk3 : AppColors.ink3)),
                        const SizedBox(height: 2),
                        SelectableText(
                          _room!.code,
                          style: AppTypography.mono(fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: 4),
                        ),
                      ],
                    ),
                    AppButton(
                      text: 'نسخ الكود',
                      variant: AppButtonVariant.soft,
                      size: AppButtonSize.sm,
                      icon: const Icon(Icons.copy, size: 14),
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: _room!.code));
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم نسخ الكود!')));
                      },
                    ),
                  ],
                ),
              ),

              const AppRule(variant: AppRuleVariant.standard, margin: EdgeInsets.symmetric(vertical: 14)),

              // Render current stage
              if (_room!.status == 'lobby')
                _buildLobbyPhase(context)
              else if (_room!.status == 'question')
                _buildQuestionPhase(context)
              else if (_room!.status == 'revealing')
                _buildRevealingPhase(context)
              else
                _buildFinishedPhase(context),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLobbyPhase(BuildContext context) {
    final players = _room!.players.values.toList();
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            AppTag(text: '${players.length} PLAYERS CONNECTED', variant: AppTagVariant.success),
            Text('المشاركون في الغرفة', style: AppTypography.arabic(fontSize: 16, fontWeight: FontWeight.w700)),
          ],
        ),
        const SizedBox(height: 12),
        if (players.isEmpty)
          AppCard(
            padding: const EdgeInsets.all(24),
            child: Center(
              child: Text(
                'في انتظار انضمام الطلاب بالكود ${_room!.code}...',
                style: AppTypography.arabic(color: isDark ? AppColors.darkInk3 : AppColors.ink3),
              ),
            ),
          )
        else
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: players.map((p) {
              return Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: isDark ? AppColors.darkPaper2 : AppColors.paper2,
                  borderRadius: BorderRadius.circular(4),
                  border: Border.all(color: isDark ? AppColors.darkRule : AppColors.rule),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircleAvatar(
                      radius: 10,
                      backgroundColor: AppColors.paper3,
                      backgroundImage: p.avatarUrl != null ? NetworkImage(p.avatarUrl!) : null,
                      child: p.avatarUrl == null ? Text(p.nickname[0], style: AppTypography.sans(fontSize: 10)) : null,
                    ),
                    const SizedBox(width: 6),
                    Text(p.nickname, style: AppTypography.arabic(fontSize: 13, fontWeight: FontWeight.w600)),
                  ],
                ),
              );
            }).toList(),
          ),
        const SizedBox(height: 24),
        AppButton(
          text: 'بدء المسابقة الآن 🎮',
          variant: AppButtonVariant.solid,
          size: AppButtonSize.lg,
          isFullWidth: true,
          onPressed: players.isNotEmpty ? _startFirstQuestion : null,
        ),
      ],
    );
  }

  Widget _buildQuestionPhase(BuildContext context) {
    final qi = _room!.currentQuestionIndex;
    final currentQ = _room!.questions.isNotEmpty && qi < _room!.questions.length ? _room!.questions[qi] : null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            AppTag(text: 'QUESTION ${qi + 1} / ${_room!.questions.length}', variant: AppTagVariant.burgundy),
            const AppTag(text: 'LIVE ACTIVE', variant: AppTagVariant.alert),
          ],
        ),
        const SizedBox(height: 12),
        if (currentQ != null)
          AppCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                MathView(
                  text: currentQ.questionAr ?? currentQ.question,
                  style: AppTypography.arabic(fontSize: 16, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 12),
                ...currentQ.choices.asMap().entries.map((e) {
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Text('${String.fromCharCode(65 + e.key)}) ${e.value}', style: AppTypography.arabic(fontSize: 13)),
                  );
                }),
              ],
            ),
          ),
        const SizedBox(height: 20),
        AppButton(
          text: 'كشف الإجابة وإيقاف المؤقت 🛑',
          variant: AppButtonVariant.solid,
          size: AppButtonSize.lg,
          isFullWidth: true,
          onPressed: _revealAnswer,
        ),
      ],
    );
  }

  Widget _buildRevealingPhase(BuildContext context) {
    final qi = _room!.currentQuestionIndex;
    final isLast = qi >= _room!.questions.length - 1;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            AppTag(text: 'REVEAL PHASE', variant: AppTagVariant.gold),
            Text('نتائج السؤال الحالي', style: AppTypography.arabic(fontSize: 16, fontWeight: FontWeight.w700)),
          ],
        ),
        const SizedBox(height: 14),
        AppButton(
          text: isLast ? 'إنهاء المسابقة وإعلان الفائزين 🏆' : 'الانتقال للسؤال التالي ➡️',
          variant: AppButtonVariant.solid,
          size: AppButtonSize.lg,
          isFullWidth: true,
          onPressed: _nextQuestion,
        ),
      ],
    );
  }

  Widget _buildFinishedPhase(BuildContext context) {
    final players = _room!.players.values.toList()..sort((a, b) => b.score.compareTo(a.score));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(
          child: Column(
            children: [
              const Icon(Icons.emoji_events, size: 56, color: AppColors.gold),
              const SizedBox(height: 8),
              Text('انتهت المسابقة وتم تتويج الفائزين!', style: AppTypography.arabic(fontSize: 18, fontWeight: FontWeight.w800)),
            ],
          ),
        ),
        const SizedBox(height: 16),
        ListView.separated(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: players.take(5).length,
          separatorBuilder: (context, index) => const SizedBox(height: 8),
          itemBuilder: (context, i) {
            final p = players[i];
            return AppCard(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              child: Row(
                children: [
                  Text('#${i + 1}', style: AppTypography.mono(fontSize: 14, fontWeight: FontWeight.w800)),
                  const SizedBox(width: 12),
                  Expanded(child: Text(p.nickname, style: AppTypography.arabic(fontSize: 14, fontWeight: FontWeight.w700))),
                  Text('${p.score} PTS', style: AppTypography.mono(fontSize: 14, fontWeight: FontWeight.w800, color: AppColors.success)),
                ],
              ),
            );
          },
        ),
        const SizedBox(height: 20),
        AppButton(
          text: 'العودة للوحة المشرف',
          variant: AppButtonVariant.solid,
          onPressed: () => context.go('/host/dashboard'),
        ),
      ],
    );
  }
}

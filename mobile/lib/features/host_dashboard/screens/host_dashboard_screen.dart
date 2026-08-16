import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/services/firebase_service.dart';
import '../../../core/services/server_clock_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_rule.dart';
import '../../../core/widgets/app_tag.dart';
import '../../auth/providers/auth_provider.dart';
import '../../deck_browser/models/deck_model.dart';
import '../widgets/upload_questions_dialog.dart';

final hostDecksProvider = FutureProvider.autoDispose<List<DeckModel>>((ref) async {
  final uid = ref.watch(authNotifierProvider).profile?.id;
  if (uid == null) return [];

  try {
    final snap = await FirebaseService.firestore
        .collection('question_sets')
        .where('host_id', isEqualTo: uid)
        .get();

    return snap.docs.map((d) => DeckModel.fromFirestore(d.id, d.data())).toList();
  } catch (_) {
    return [];
  }
});

class HostDashboardScreen extends ConsumerWidget {
  const HostDashboardScreen({super.key});

  String _generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    final random = Random();
    return List.generate(6, (index) => chars[random.nextInt(chars.length)]).join();
  }

  Future<void> _launchGameRoom(BuildContext context, WidgetRef ref, DeckModel deck) async {
    final profile = ref.read(authNotifierProvider).profile;
    if (profile == null) return;

    final roomCode = _generateRoomCode();

    final roomData = {
      'code': roomCode,
      'host_id': profile.id,
      'question_set_id': deck.id,
      'title': deck.title,
      'questions': {
        'title': deck.title,
        'questions': deck.questions.map((q) => q.toMap()).toList(),
      },
      'force_rtl': deck.forceRtl,
      'status': 'lobby',
      'current_question_index': 0,
      'config': {
        'timer_seconds': 30,
        'auto_accept': true,
      },
      'created_at': ServerClockService().serverNowMs,
    };

    await FirebaseService.rtdb.ref('rooms/$roomCode').set(roomData);
    await FirebaseService.rtdb.ref('host_rooms/${profile.id}/active').set({
      'code': roomCode,
      'title': deck.title,
    });

    if (context.mounted) {
      context.push('/host/game/$roomCode');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final decksAsync = ref.watch(hostDecksProvider);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'لوحة تحكم المشرف (Host)',
          style: AppTypography.serif(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Header Card
              AppCard(
                variant: AppCardVariant.flat,
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    const AppTag(text: 'HOST CONTROL PANEL', variant: AppTagVariant.burgundy),
                    const SizedBox(height: 10),
                    Text(
                      'إدارة بنوك الأسئلة والغرف الحية',
                      style: AppTypography.arabic(fontSize: 18, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'أنشئ مسابقات تفاعلية للدفعة، أطلق الغرف بكود الانضمام، وتحكم في بدء الأسئلة وعرض النتائج.',
                      textAlign: TextAlign.center,
                      style: AppTypography.arabic(fontSize: 13, color: isDark ? AppColors.darkInk3 : AppColors.ink3),
                    ),
                    const SizedBox(height: 16),
                    AppButton(
                      text: 'رفع بنك أسئلة جديد (AI / JSON)',
                      variant: AppButtonVariant.solid,
                      icon: const Icon(Icons.add, size: 18),
                      onPressed: () async {
                        final res = await showDialog<bool>(
                          context: context,
                          builder: (_) => const UploadQuestionsDialog(),
                        );
                        if (res == true) ref.invalidate(hostDecksProvider);
                      },
                    ),
                  ],
                ),
              ),

              const AppRule(variant: AppRuleVariant.thick, margin: EdgeInsets.symmetric(vertical: 18)),

              Text(
                'بنوك الأسئلة الخاصة بك',
                textAlign: TextAlign.right,
                style: AppTypography.arabic(fontSize: 16, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 10),

              decksAsync.when(
                loading: () => const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
                error: (err, _) => Center(child: Text('خطأ في تحميل البنوك: $err', style: AppTypography.arabic(color: AppColors.alert))),
                data: (decks) {
                  if (decks.isEmpty) {
                    return AppCard(
                      padding: const EdgeInsets.all(24),
                      child: Center(
                        child: Text(
                          'لم تقم بإنشاء أي بنوك أسئلة بعد.\nاضغط على الزر أعلاه لرفع أول بنك بالذكاء الاصطناعي.',
                          textAlign: TextAlign.center,
                          style: AppTypography.arabic(fontSize: 14, color: isDark ? AppColors.darkInk3 : AppColors.ink3),
                        ),
                      ),
                    );
                  }

                  return ListView.separated(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: decks.length,
                    separatorBuilder: (context, index) => const SizedBox(height: 12),
                    itemBuilder: (context, i) {
                      final deck = decks[i];
                      return AppCard(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                AppTag(text: '${deck.questionCount} QUESTIONS', variant: AppTagVariant.navy),
                                Text(deck.title, style: AppTypography.arabic(fontSize: 16, fontWeight: FontWeight.w700)),
                              ],
                            ),
                            const SizedBox(height: 14),
                            AppButton(
                              text: 'إطلاق غرفة مسابقة حية 🎙️',
                              variant: AppButtonVariant.solid,
                              size: AppButtonSize.md,
                              isFullWidth: true,
                              onPressed: () => _launchGameRoom(context, ref, deck),
                            ),
                          ],
                        ),
                      );
                    },
                  );
                },
              ),

              const SizedBox(height: 30),
            ],
          ),
        ),
      ),
    );
  }
}

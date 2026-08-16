import 'package:flutter/material.dart';
import '../../../core/services/sound_service.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_tag.dart';

class SoundTestScreen extends StatelessWidget {
  const SoundTestScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final sounds = [
      {'name': 'Tada / Correct', 'fn': () => SoundService().playTada()},
      {'name': 'Wrong Buzzer', 'fn': () => SoundService().playWrong()},
      {'name': 'Victory Theme', 'fn': () => SoundService().playVictory()},
      {'name': 'Applause Crowd', 'fn': () => SoundService().playApplause()},
      {'name': 'Audience Gasp', 'fn': () => SoundService().playGasp()},
      {'name': 'Audience Boo', 'fn': () => SoundService().playBoo()},
    ];

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'اختبار المؤثرات الصوتية',
          style: AppTypography.serif(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Center(child: AppTag(text: 'AUDIO SYSTEM AUDIT', variant: AppTagVariant.burgundy)),
              const SizedBox(height: 16),
              Expanded(
                child: GridView.builder(
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    crossAxisSpacing: 12,
                    mainAxisSpacing: 12,
                    childAspectRatio: 1.4,
                  ),
                  itemCount: sounds.length,
                  itemBuilder: (context, i) {
                    final item = sounds[i];
                    return AppCard(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(item['name'] as String, style: AppTypography.sans(fontSize: 13, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 10),
                          AppButton(
                            text: 'تشغيل الصوت 🔊',
                            variant: AppButtonVariant.soft,
                            size: AppButtonSize.sm,
                            onPressed: item['fn'] as VoidCallback,
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

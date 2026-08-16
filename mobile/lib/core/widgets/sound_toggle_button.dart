import 'package:flutter/material.dart';
import '../services/sound_service.dart';
import '../theme/app_colors.dart';

class SoundToggleButton extends StatelessWidget {
  const SoundToggleButton({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return ValueListenableBuilder<bool>(
      valueListenable: SoundService().isMutedNotifier,
      builder: (context, isMuted, _) {
        return IconButton(
          tooltip: isMuted ? 'تشغيل الصوت' : 'كتم الصوت',
          icon: Icon(
            isMuted ? Icons.volume_off_outlined : Icons.volume_up_outlined,
            color: isDark ? AppColors.darkInk : AppColors.ink,
            size: 20,
          ),
          onPressed: () => SoundService().toggleMute(),
        );
      },
    );
  }
}

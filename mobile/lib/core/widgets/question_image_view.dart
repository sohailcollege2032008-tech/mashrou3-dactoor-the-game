import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

class QuestionImageView extends StatelessWidget {
  final String imageUrl;

  const QuestionImageView({super.key, required this.imageUrl});

  @override
  Widget build(BuildContext context) {
    if (imageUrl.isEmpty) return const SizedBox.shrink();

    return GestureDetector(
      onTap: () {
        showDialog(
          context: context,
          builder: (ctx) => Dialog(
            backgroundColor: Colors.black,
            insetPadding: EdgeInsets.zero,
            child: Stack(
              children: [
                InteractiveViewer(
                  maxScale: 4.0,
                  minScale: 0.8,
                  child: Center(
                    child: CachedNetworkImage(
                      imageUrl: imageUrl,
                      fit: BoxFit.contain,
                      placeholder: (c, u) => const Center(
                        child: CircularProgressIndicator(color: Colors.white),
                      ),
                      errorWidget: (c, u, e) => const Icon(Icons.broken_image, color: Colors.white54, size: 48),
                    ),
                  ),
                ),
                Positioned(
                  top: 40,
                  right: 20,
                  child: IconButton(
                    icon: const Icon(Icons.close, color: Colors.white, size: 30),
                    onPressed: () => Navigator.of(ctx).pop(),
                  ),
                ),
              ],
            ),
          ),
        );
      },
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 8),
        constraints: const BoxConstraints(maxHeight: 220),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(4),
          border: Border.all(color: AppColors.rule),
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          alignment: Alignment.bottomRight,
          children: [
            CachedNetworkImage(
              imageUrl: imageUrl,
              width: double.infinity,
              fit: BoxFit.contain,
              placeholder: (context, url) => Container(
                height: 140,
                color: AppColors.paper2,
                child: const Center(
                  child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.ink3),
                ),
              ),
              errorWidget: (context, url, error) => Container(
                height: 100,
                color: AppColors.paper2,
                child: const Center(
                  child: Icon(Icons.broken_image, color: AppColors.ink4),
                ),
              ),
            ),
            Container(
              margin: const EdgeInsets.all(6),
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.6),
                borderRadius: BorderRadius.circular(2),
              ),
              child: const Icon(Icons.zoom_in, color: Colors.white, size: 16),
            ),
          ],
        ),
      ),
    );
  }
}

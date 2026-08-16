import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_rule.dart';
import '../../../core/widgets/app_tag.dart';
import '../models/deck_model.dart';
import '../providers/deck_provider.dart';
import '../widgets/duel_config_sheet.dart';

class DeckBrowserScreen extends ConsumerWidget {
  const DeckBrowserScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filteredDecks = ref.watch(filteredDecksProvider);
    final availableTags = ref.watch(availableTagsProvider);
    final selectedTag = ref.watch(selectedTagProvider);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'بنوك الأسئلة والنزالات',
          style: AppTypography.serif(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: Column(
          children: [
            // Search Box
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: TextField(
                textAlign: TextAlign.right,
                style: AppTypography.arabic(fontSize: 14),
                onChanged: (val) => ref.read(deckSearchQueryProvider.notifier).state = val,
                decoration: InputDecoration(
                  hintText: 'ابحث في بنوك الأسئلة الطبية...',
                  prefixIcon: const Icon(Icons.search, size: 20),
                  filled: true,
                  fillColor: isDark ? AppColors.darkPaper2 : AppColors.paper2,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(4),
                    borderSide: BorderSide(color: isDark ? AppColors.darkRule : AppColors.rule),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(4),
                    borderSide: BorderSide(color: isDark ? AppColors.darkRule : AppColors.rule),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(4),
                    borderSide: BorderSide(color: isDark ? AppColors.darkInk : AppColors.ink),
                  ),
                ),
              ),
            ),

            // Tag Filter Chips
            if (availableTags.isNotEmpty)
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: Row(
                  children: [
                    AppTag(
                      text: 'الكل (ALL)',
                      variant: selectedTag == null ? AppTagVariant.filled : AppTagVariant.ghost,
                      onTap: () => ref.read(selectedTagProvider.notifier).state = null,
                    ),
                    const SizedBox(width: 8),
                    ...availableTags.map((tag) {
                      final isSelected = selectedTag == tag;
                      return Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: AppTag(
                          text: tag.toUpperCase(),
                          variant: isSelected ? AppTagVariant.burgundy : AppTagVariant.ghost,
                          onTap: () {
                            ref.read(selectedTagProvider.notifier).state = isSelected ? null : tag;
                          },
                        ),
                      );
                    }),
                  ],
                ),
              ),

            const AppRule(variant: AppRuleVariant.standard, margin: EdgeInsets.symmetric(vertical: 8)),

            // Deck List
            Expanded(
              child: filteredDecks.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.library_books_outlined, size: 48, color: AppColors.ink4),
                          const SizedBox(height: 12),
                          Text(
                            'لا توجد بنوك أسئلة متطابقة',
                            style: AppTypography.arabic(
                              fontSize: 15,
                              color: isDark ? AppColors.darkInk3 : AppColors.ink3,
                            ),
                          ),
                        ],
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      itemCount: filteredDecks.length,
                      separatorBuilder: (context, index) => const SizedBox(height: 12),
                      itemBuilder: (context, index) {
                        final deck = filteredDecks[index];
                        return _buildDeckCard(context, deck);
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDeckCard(BuildContext context, DeckModel deck) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return AppCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              AppTag(
                text: '${deck.questionCount} QUESTIONS',
                variant: AppTagVariant.navy,
              ),
              if (deck.forceRtl)
                const AppTag(text: 'RTL', variant: AppTagVariant.ghost),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            deck.title,
            textAlign: TextAlign.right,
            style: AppTypography.arabic(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: isDark ? AppColors.darkInk : AppColors.ink,
            ),
          ),
          if (deck.tags.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: deck.tags.map((t) => AppTag(text: t, variant: AppTagVariant.ghost)).toList(),
            ),
          ],
          const SizedBox(height: 14),
          AppButton(
            text: 'بدء نزال 1 ضد 1 ⚔️',
            variant: AppButtonVariant.solid,
            size: AppButtonSize.md,
            isFullWidth: true,
            onPressed: () {
              showModalBottomSheet(
                context: context,
                isScrollControlled: true,
                backgroundColor: Colors.transparent,
                builder: (_) => DuelConfigSheet(deck: deck),
              );
            },
          ),
        ],
      ),
    );
  }
}

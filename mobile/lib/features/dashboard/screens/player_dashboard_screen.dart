import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_rule.dart';
import '../../../core/widgets/app_tag.dart';
import '../../../core/widgets/sound_toggle_button.dart';
import '../../../core/widgets/stat_block.dart';
import '../../auth/providers/auth_provider.dart';
import '../providers/dashboard_provider.dart';

class PlayerDashboardScreen extends ConsumerWidget {
  const PlayerDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authNotifierProvider);
    final statsAsync = ref.watch(playerStatsProvider);
    final matchesAsync = ref.watch(recentMatchesProvider);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    final profile = authState.profile;

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(playerStatsProvider);
            ref.invalidate(recentMatchesProvider);
          },
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Top Editorial Navigation Bar
                Row(
                  children: [
                    GestureDetector(
                      onTap: () => context.push('/profile'),
                      child: Container(
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
                              radius: 12,
                              backgroundColor: AppColors.paper3,
                              backgroundImage: profile?.avatarUrl != null ? NetworkImage(profile!.avatarUrl!) : null,
                              child: profile?.avatarUrl == null
                                  ? Text(
                                      (profile?.displayName ?? 'P')[0].toUpperCase(),
                                      style: AppTypography.serif(fontSize: 11, fontWeight: FontWeight.w700),
                                    )
                                  : null,
                            ),
                            const SizedBox(width: 8),
                            ConstrainedBox(
                              constraints: const BoxConstraints(maxWidth: 110),
                              child: Text(
                                profile?.displayName ?? 'الطبيب',
                                overflow: TextOverflow.ellipsis,
                                style: AppTypography.sans(fontSize: 13, fontWeight: FontWeight.w600),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const Spacer(),
                    if (profile?.isOwner == true)
                      const Padding(
                        padding: EdgeInsets.only(right: 6),
                        child: AppTag(text: 'OWNER', variant: AppTagVariant.gold),
                      )
                    else if (profile?.isHost == true)
                      const Padding(
                        padding: EdgeInsets.only(right: 6),
                        child: AppTag(text: 'HOST', variant: AppTagVariant.burgundy),
                      ),
                    const SoundToggleButton(),
                  ],
                ),

                const SizedBox(height: 18),

                // Main Title & Academic Date
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      'لوحة التحكم',
                      style: AppTypography.serif(
                        fontSize: 26,
                        fontWeight: FontWeight.w700,
                        color: isDark ? AppColors.darkInk : AppColors.ink,
                      ),
                    ),
                    Text(
                      'MED ROYALE · BATCH 62',
                      style: AppTypography.folio(
                        color: isDark ? AppColors.darkInk3 : AppColors.ink3,
                      ),
                    ),
                  ],
                ),

                const AppRule(variant: AppRuleVariant.thick, margin: EdgeInsets.only(top: 8, bottom: 16)),

                // Primary Quick Actions Grid
                GridView.count(
                  crossAxisCount: 2,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  crossAxisSpacing: 10,
                  mainAxisSpacing: 10,
                  childAspectRatio: 1.25,
                  children: [
                    _buildActionCard(
                      context,
                      title: 'نزالات 1 ضد 1',
                      subtitle: 'تحدَّ زميلاً أو ادخل طابور المطابقة',
                      icon: Icons.flash_on_outlined,
                      tag: 'DUELS',
                      tagVariant: AppTagVariant.burgundy,
                      onTap: () => context.push('/decks'),
                    ),
                    _buildActionCard(
                      context,
                      title: 'انضم لغرفة حية',
                      subtitle: 'أدخل كود الغرفة للمنافسة المباشرة',
                      icon: Icons.meeting_room_outlined,
                      tag: 'JOIN GAME',
                      tagVariant: AppTagVariant.navy,
                      onTap: () => context.push('/join'),
                    ),
                    _buildActionCard(
                      context,
                      title: 'البطولات',
                      subtitle: 'تصفيات وإقصاء مباشر بنظام الشجرة',
                      icon: Icons.emoji_events_outlined,
                      tag: 'TOURNAMENT',
                      tagVariant: AppTagVariant.gold,
                      onTap: () => context.push('/tournaments'),
                    ),
                    if (profile?.isHost == true)
                      _buildActionCard(
                        context,
                        title: 'لوحة المشرف',
                        subtitle: 'إنشاء بنوك أسئلة وإدارة غرف حية',
                        icon: Icons.dashboard_customize_outlined,
                        tag: 'HOST PANEL',
                        tagVariant: AppTagVariant.success,
                        onTap: () => context.push('/host/dashboard'),
                      )
                    else
                      _buildActionCard(
                        context,
                        title: 'بنوك الأسئلة',
                        subtitle: 'تصفح بنوك الأسئلة الطبية والمعادلات',
                        icon: Icons.menu_book_outlined,
                        tag: 'QUESTION BANKS',
                        tagVariant: AppTagVariant.ghost,
                        onTap: () => context.push('/decks'),
                      ),
                  ],
                ),

                if (profile?.isOwner == true) ...[
                  const SizedBox(height: 10),
                  AppCard(
                    variant: AppCardVariant.flat,
                    onTap: () => context.push('/owner/dashboard'),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const AppTag(text: 'OWNER ONLY', variant: AppTagVariant.gold),
                        Row(
                          children: [
                            Text(
                              'لوحة تحكم المالك وسجلات النظام',
                              style: AppTypography.arabic(fontSize: 14, fontWeight: FontWeight.w700),
                            ),
                            const SizedBox(width: 8),
                            const Icon(Icons.admin_panel_settings_outlined, size: 20, color: AppColors.gold),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],

                const SizedBox(height: 20),

                // Statistics Section
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'إحصائياتك الأكاديمية',
                      style: AppTypography.arabic(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: isDark ? AppColors.darkInk : AppColors.ink,
                      ),
                    ),
                    Text(
                      'PERFORMANCE METRICS',
                      style: AppTypography.folio(color: isDark ? AppColors.darkInk4 : AppColors.ink4),
                    ),
                  ],
                ),

                const AppRule(variant: AppRuleVariant.standard, margin: EdgeInsets.only(top: 6, bottom: 12)),

                statsAsync.when(
                  loading: () => const Center(child: Padding(padding: EdgeInsets.all(20), child: CircularProgressIndicator())),
                  error: (err, _) => Center(child: Text('خطأ في تحميل الإحصائيات: $err', style: AppTypography.arabic(color: AppColors.alert))),
                  data: (stats) => Column(
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: AppCard(
                              variant: AppCardVariant.flat,
                              padding: const EdgeInsets.all(12),
                              child: StatBlock(
                                label: 'النزالات الملعوبة',
                                value: '${stats.duelsPlayed}',
                                size: StatValueSize.md,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: AppCard(
                              variant: AppCardVariant.flat,
                              padding: const EdgeInsets.all(12),
                              child: StatBlock(
                                label: 'نسبة الفوز',
                                value: '${stats.winRate.toStringAsFixed(0)}%',
                                size: StatValueSize.md,
                                valueColor: stats.winRate >= 50 ? AppColors.success : AppColors.burgundy,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: AppCard(
                              variant: AppCardVariant.flat,
                              padding: const EdgeInsets.all(12),
                              child: StatBlock(
                                label: 'إجمالي النقاط',
                                value: '${stats.totalPoints}',
                                size: StatValueSize.md,
                                valueColor: AppColors.navy,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: AppCard(
                              variant: AppCardVariant.flat,
                              padding: const EdgeInsets.all(12),
                              child: StatBlock(
                                label: 'أسئلة تمت ممارستها',
                                value: '${stats.playedQuestionsCount}',
                                size: StatValueSize.md,
                                valueColor: AppColors.gold,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 24),

                // Recent Matches History
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'سجل النزالات الأخيرة',
                      style: AppTypography.arabic(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: isDark ? AppColors.darkInk : AppColors.ink,
                      ),
                    ),
                    Text(
                      'MATCH HISTORY',
                      style: AppTypography.folio(color: isDark ? AppColors.darkInk4 : AppColors.ink4),
                    ),
                  ],
                ),

                const AppRule(variant: AppRuleVariant.standard, margin: EdgeInsets.only(top: 6, bottom: 12)),

                matchesAsync.when(
                  loading: () => const Center(child: Padding(padding: EdgeInsets.all(20), child: CircularProgressIndicator())),
                  error: (err, _) => Center(child: Text('خطأ في تحميل السجل', style: AppTypography.arabic(color: AppColors.alert))),
                  data: (matches) {
                    if (matches.isEmpty) {
                      return AppCard(
                        variant: AppCardVariant.flat,
                        padding: const EdgeInsets.all(24),
                        child: Center(
                          child: Column(
                            children: [
                              const Icon(Icons.history_toggle_off, size: 36, color: AppColors.ink4),
                              const SizedBox(height: 8),
                              Text(
                                'لم تلعب أي نزالات بعد',
                                style: AppTypography.arabic(fontSize: 14, color: isDark ? AppColors.darkInk3 : AppColors.ink3),
                              ),
                              const SizedBox(height: 12),
                              AppButton(
                                text: 'ابدأ أول نزال الآن',
                                size: AppButtonSize.sm,
                                variant: AppButtonVariant.solid,
                                onPressed: () => context.push('/decks'),
                              ),
                            ],
                          ),
                        ),
                      );
                    }

                    return ListView.separated(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      itemCount: matches.length,
                      separatorBuilder: (context, index) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final m = matches[index];
                        AppTagVariant outcomeTag;
                        String outcomeText;
                        if (m.outcome == 'won') {
                          outcomeTag = AppTagVariant.success;
                          outcomeText = 'فوز 🏆';
                        } else if (m.outcome == 'lost') {
                          outcomeTag = AppTagVariant.burgundy;
                          outcomeText = 'خسارة';
                        } else {
                          outcomeTag = AppTagVariant.gold;
                          outcomeText = 'تعادل ⚖️';
                        }

                        return AppCard(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          child: Row(
                            children: [
                              AppTag(text: outcomeText, variant: outcomeTag),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      m.deckTitle,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: AppTypography.arabic(fontSize: 13, fontWeight: FontWeight.w700),
                                    ),
                                    Text(
                                      'ضد: ${m.opponentNickname}',
                                      style: AppTypography.arabic(fontSize: 12, color: isDark ? AppColors.darkInk3 : AppColors.ink3),
                                    ),
                                  ],
                                ),
                              ),
                              Text(
                                '${m.myScore} - ${m.opponentScore}',
                                style: AppTypography.mono(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                  color: m.outcome == 'won' ? AppColors.success : isDark ? AppColors.darkInk : AppColors.ink,
                                ),
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
      ),
    );
  }

  Widget _buildActionCard(
    BuildContext context, {
    required String title,
    required String subtitle,
    required IconData icon,
    required String tag,
    required AppTagVariant tagVariant,
    required VoidCallback onTap,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              AppTag(text: tag, variant: tagVariant),
              Icon(icon, size: 20, color: isDark ? AppColors.darkInk2 : AppColors.ink2),
            ],
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                title,
                textAlign: TextAlign.right,
                style: AppTypography.arabic(fontSize: 14, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                textAlign: TextAlign.right,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppTypography.arabic(
                  fontSize: 11,
                  color: isDark ? AppColors.darkInk4 : AppColors.ink4,
                  height: 1.2,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

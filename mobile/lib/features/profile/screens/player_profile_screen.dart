import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_rule.dart';
import '../../../core/widgets/app_tag.dart';
import '../../auth/providers/auth_provider.dart';

class PlayerProfileScreen extends ConsumerStatefulWidget {
  const PlayerProfileScreen({super.key});

  @override
  ConsumerState<PlayerProfileScreen> createState() => _PlayerProfileScreenState();
}

class _PlayerProfileScreenState extends ConsumerState<PlayerProfileScreen> {
  final TextEditingController _nameController = TextEditingController();
  bool _isSaving = false;
  String? _selectedAvatar;

  final List<String> _presetAvatars = [
    'https://api.dicebear.com/7.x/bottts/png?seed=Medic1',
    'https://api.dicebear.com/7.x/bottts/png?seed=Surgeon',
    'https://api.dicebear.com/7.x/bottts/png?seed=DoctorAzhar',
    'https://api.dicebear.com/7.x/bottts/png?seed=Caduceus',
    'https://api.dicebear.com/7.x/bottts/png?seed=Neuro62',
    'https://api.dicebear.com/7.x/bottts/png?seed=PharmaAzhar',
  ];

  @override
  void initState() {
    super.initState();
    final profile = ref.read(authNotifierProvider).profile;
    _nameController.text = profile?.displayName ?? '';
    _selectedAvatar = profile?.avatarUrl;
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authNotifierProvider);
    final profile = authState.profile;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'الملف الشخصي',
          style: AppTypography.serif(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Current Avatar & Identity Banner
              Center(
                child: Column(
                  children: [
                    CircleAvatar(
                      radius: 40,
                      backgroundColor: AppColors.paper3,
                      backgroundImage: _selectedAvatar != null ? NetworkImage(_selectedAvatar!) : null,
                      child: _selectedAvatar == null
                          ? Text(
                              (profile?.displayName ?? 'P')[0].toUpperCase(),
                              style: AppTypography.serif(fontSize: 32, fontWeight: FontWeight.w700),
                            )
                          : null,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      profile?.displayName ?? 'الطبيب',
                      style: AppTypography.arabic(fontSize: 20, fontWeight: FontWeight.w700),
                    ),
                    Text(
                      profile?.email ?? '',
                      style: AppTypography.sans(fontSize: 13, color: isDark ? AppColors.darkInk3 : AppColors.ink3),
                    ),
                    const SizedBox(height: 8),
                    AppTag(
                      text: (profile?.role ?? 'PLAYER').toUpperCase(),
                      variant: profile?.isOwner == true
                          ? AppTagVariant.gold
                          : profile?.isHost == true
                              ? AppTagVariant.burgundy
                              : AppTagVariant.navy,
                    ),
                  ],
                ),
              ),

              const AppRule(variant: AppRuleVariant.standard, margin: EdgeInsets.symmetric(vertical: 20)),

              // Edit Nickname
              Text(
                'الاسم المعروض في المباريات',
                textAlign: TextAlign.right,
                style: AppTypography.arabic(fontSize: 14, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _nameController,
                textAlign: TextAlign.right,
                style: AppTypography.arabic(fontSize: 14),
                decoration: InputDecoration(
                  hintText: 'أدخل لقبك في المسابقة',
                  filled: true,
                  fillColor: isDark ? AppColors.darkPaper2 : AppColors.paper2,
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
                    borderSide: BorderSide(color: isDark ? AppColors.darkInk : AppColors.ink, width: 1.5),
                  ),
                ),
              ),

              const SizedBox(height: 20),

              // Preset Avatars
              Text(
                'اختر صورة رمزية طبية',
                textAlign: TextAlign.right,
                style: AppTypography.arabic(fontSize: 14, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                alignment: WrapAlignment.center,
                children: _presetAvatars.map((url) {
                  final isSelected = _selectedAvatar == url;
                  return GestureDetector(
                    onTap: () => setState(() => _selectedAvatar = url),
                    child: Container(
                      padding: const EdgeInsets.all(3),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: isSelected ? AppColors.gold : Colors.transparent,
                          width: 2.5,
                        ),
                      ),
                      child: CircleAvatar(
                        radius: 26,
                        backgroundImage: NetworkImage(url),
                        backgroundColor: AppColors.paper3,
                      ),
                    ),
                  );
                }).toList(),
              ),

              const SizedBox(height: 24),

              // Save Button
              AppButton(
                text: 'حفظ التعديلات',
                variant: AppButtonVariant.solid,
                size: AppButtonSize.lg,
                isFullWidth: true,
                isLoading: _isSaving,
                onPressed: () async {
                  setState(() => _isSaving = true);
                  final name = _nameController.text.trim();
                  await ref.read(authNotifierProvider.notifier).updateProfile(
                        displayName: name.isNotEmpty ? name : null,
                        avatarUrl: _selectedAvatar,
                      );
                  setState(() => _isSaving = false);
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('تم حفظ التعديلات بنجاح')),
                    );
                  }
                },
              ),

              const SizedBox(height: 12),

              // Sign Out Button
              AppButton(
                text: 'تسجيل الخروج',
                variant: AppButtonVariant.ghost,
                size: AppButtonSize.md,
                isFullWidth: true,
                onPressed: () async {
                  await ref.read(authNotifierProvider.notifier).signOut();
                  if (context.mounted) context.go('/');
                },
              ),

              const SizedBox(height: 20),
            ],
          ),
        ),
      ),
    );
  }
}

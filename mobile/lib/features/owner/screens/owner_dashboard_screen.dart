import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/services/firebase_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_rule.dart';
import '../../../core/widgets/app_tag.dart';

class OwnerDashboardScreen extends ConsumerStatefulWidget {
  const OwnerDashboardScreen({super.key});

  @override
  ConsumerState<OwnerDashboardScreen> createState() => _OwnerDashboardScreenState();
}

class _OwnerDashboardScreenState extends ConsumerState<OwnerDashboardScreen> {
  final TextEditingController _hostEmailController = TextEditingController();
  bool _isLoading = false;

  @override
  void dispose() {
    _hostEmailController.dispose();
    super.dispose();
  }

  Future<void> _addHost() async {
    final email = _hostEmailController.text.trim().toLowerCase();
    if (email.isEmpty || !email.contains('@')) return;

    setState(() => _isLoading = true);
    try {
      await FirebaseService.firestore.collection('authorized_hosts').add({
        'email': email,
        'is_active': true,
        'added_at': FieldValue.serverTimestamp(),
      });
      _hostEmailController.clear();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تمت إضافة المشرف بنجاح')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('خطأ: $e')));
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
          'لوحة إدارة المالك (Owner)',
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
              AppCard(
                variant: AppCardVariant.flat,
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    const AppTag(text: 'OWNER PRIVILEGES', variant: AppTagVariant.gold),
                    const SizedBox(height: 10),
                    Text(
                      'إدارة المشرفين وصلاحيات المنصة',
                      style: AppTypography.arabic(fontSize: 18, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'يمكنك هنا اعتماد حسابات المشرفين (Hosts) ليتمكنوا من رفع الأسئلة وإطلاق المسابقات الحية.',
                      textAlign: TextAlign.center,
                      style: AppTypography.arabic(fontSize: 13, color: isDark ? AppColors.darkInk3 : AppColors.ink3),
                    ),
                  ],
                ),
              ),

              const AppRule(variant: AppRuleVariant.thick, margin: EdgeInsets.symmetric(vertical: 18)),

              Text(
                'إضافة مشرف جديد (Authorized Host)',
                textAlign: TextAlign.right,
                style: AppTypography.arabic(fontSize: 15, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),

              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _hostEmailController,
                      style: AppTypography.sans(fontSize: 14),
                      decoration: InputDecoration(
                        hintText: 'user@gmail.com',
                        filled: true,
                        fillColor: isDark ? AppColors.darkPaper2 : AppColors.paper2,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(4)),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  AppButton(
                    text: 'إضافة',
                    variant: AppButtonVariant.solid,
                    isLoading: _isLoading,
                    onPressed: _addHost,
                  ),
                ],
              ),

              const SizedBox(height: 24),

              Text(
                'المشرفون المعتمدون حالياً',
                textAlign: TextAlign.right,
                style: AppTypography.arabic(fontSize: 15, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 10),

              StreamBuilder<QuerySnapshot>(
                stream: FirebaseService.firestore.collection('authorized_hosts').snapshots(),
                builder: (context, snapshot) {
                  if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
                  final docs = snapshot.data!.docs;
                  if (docs.isEmpty) {
                    return AppCard(
                      padding: const EdgeInsets.all(16),
                      child: Center(child: Text('لا يوجد مشرفون بعد', style: AppTypography.arabic())),
                    );
                  }

                  return ListView.separated(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: docs.length,
                    separatorBuilder: (context, index) => const SizedBox(height: 8),
                    itemBuilder: (context, i) {
                      final data = docs[i].data() as Map<String, dynamic>;
                      final email = data['email'] ?? '';
                      return AppCard(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            IconButton(
                              icon: const Icon(Icons.delete_outline, size: 20, color: AppColors.alert),
                              onPressed: () => docs[i].reference.delete(),
                            ),
                            Text(email, style: AppTypography.sans(fontSize: 14, fontWeight: FontWeight.w600)),
                          ],
                        ),
                      );
                    },
                  );
                },
              ),

              const SizedBox(height: 24),

              // Soundboard test tool button
              AppButton(
                text: 'فتح لوحة اختبار المؤثرات الصوتية 🔊',
                variant: AppButtonVariant.soft,
                size: AppButtonSize.md,
                onPressed: () => context.push('/sound-test'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

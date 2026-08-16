import 'dart:convert';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/services/cloud_run_service.dart';
import '../../../core/services/firebase_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_rule.dart';
import '../../../core/widgets/app_tag.dart';
import '../../auth/providers/auth_provider.dart';

class UploadQuestionsDialog extends ConsumerStatefulWidget {
  const UploadQuestionsDialog({super.key});

  @override
  ConsumerState<UploadQuestionsDialog> createState() => _UploadQuestionsDialogState();
}

class _UploadQuestionsDialogState extends ConsumerState<UploadQuestionsDialog> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final TextEditingController _jsonController = TextEditingController();

  bool _isProcessing = false;
  bool _isSaving = false;
  String? _statusMessage;
  Map<String, dynamic>? _extractedData;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _jsonController.dispose();
    super.dispose();
  }

  Future<void> _pickAndProcessFile() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf', 'pptx', 'docx', 'doc', 'txt', 'png', 'jpg', 'jpeg'],
      withData: true,
    );

    if (result == null || result.files.isEmpty) return;

    final file = result.files.first;
    if (file.bytes == null) return;

    setState(() {
      _isProcessing = true;
      _statusMessage = 'جاري المعالجة بنظام Multi-Model Fallback (Gemini)...';
    });

    try {
      final res = await CloudRunService.processDocument(
        fileBytes: file.bytes!,
        fileName: file.name,
      );

      setState(() {
        _extractedData = res;
        _statusMessage = null;
      });
    } catch (e) {
      setState(() {
        _statusMessage = 'فشل في استخراج الأسئلة: $e';
      });
    } finally {
      setState(() => _isProcessing = false);
    }
  }

  void _parseManualJson() {
    final text = _jsonController.text.trim();
    if (text.isEmpty) return;

    try {
      final decoded = jsonDecode(text);
      if (decoded is Map<String, dynamic> && decoded['questions'] is List) {
        setState(() {
          _extractedData = decoded;
          _statusMessage = null;
        });
      } else {
        setState(() => _statusMessage = 'يجب أن يحتوي الـ JSON على حقل questions كمصفوفة');
      }
    } catch (e) {
      setState(() => _statusMessage = 'صيغة JSON غير صالحة: $e');
    }
  }

  Future<void> _saveDeckToFirestore() async {
    if (_extractedData == null) return;

    final profile = ref.read(authNotifierProvider).profile;
    if (profile == null) return;

    setState(() => _isSaving = true);

    try {
      final title = (_extractedData!['title'] as String?) ?? 'بنك أسئلة جديد';
      final rawQuestions = _extractedData!['questions'] as List;

      final formattedQuestions = rawQuestions.asMap().entries.map((e) {
        final q = e.value as Map;
        return {
          'id': e.key + 1,
          'question': q['question'] ?? '',
          'question_ar': q['question_ar'],
          'choices': q['choices'] ?? [],
          'correct': q['correct'] ?? 0,
          'needs_image': q['needs_image'] == true,
          'image_url': q['image_url'],
        };
      }).toList();

      await FirebaseService.firestore.collection('question_sets').add({
        'host_id': profile.id,
        'title': title,
        'questions': {'title': title, 'questions': formattedQuestions},
        'question_count': formattedQuestions.length,
        'source_type': _tabController.index == 0 ? 'ai' : 'json',
        'is_global': true,
        'tags': ['طب', 'Al-Azhar'],
        'force_rtl': true,
        'created_at': DateTime.now().toIso8601String(),
      });

      if (mounted) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم حفظ بنك الأسئلة بنجاح!')),
        );
      }
    } catch (e) {
      setState(() => _statusMessage = 'فشل في حفظ البنك: $e');
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Dialog(
      backgroundColor: isDark ? AppColors.darkPaper : AppColors.paper,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 550, maxHeight: 650),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const AppTag(text: 'AI PROCESSOR', variant: AppTagVariant.burgundy),
                  IconButton(
                    icon: const Icon(Icons.close, size: 20),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                'رفع وتوليد بنك أسئلة جديد',
                style: AppTypography.arabic(fontSize: 18, fontWeight: FontWeight.w700),
              ),

              const SizedBox(height: 12),

              TabBar(
                controller: _tabController,
                indicatorColor: isDark ? AppColors.darkInk : AppColors.ink,
                labelColor: isDark ? AppColors.darkInk : AppColors.ink,
                unselectedLabelColor: isDark ? AppColors.darkInk4 : AppColors.ink4,
                tabs: const [
                  Tab(text: 'معالجة بالذكاء الاصطناعي 🤖'),
                  Tab(text: 'استيراد JSON 📄'),
                ],
              ),

              const SizedBox(height: 16),

              Expanded(
                child: _extractedData != null
                    ? _buildPreviewSection(context)
                    : TabBarView(
                        controller: _tabController,
                        children: [
                          // AI Tab
                          Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(Icons.cloud_upload_outlined, size: 48, color: AppColors.burgundy),
                              const SizedBox(height: 12),
                              Text(
                                'اختر ملف PDF أو DOCX أو صور امتحانات',
                                style: AppTypography.arabic(fontSize: 14, fontWeight: FontWeight.w600),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                'سيقوم نظام Cloud Run باستخراج جميع الأسئلة وصيغ LaTeX ومعادلات MathML بدقة.',
                                textAlign: TextAlign.center,
                                style: AppTypography.arabic(fontSize: 12, color: isDark ? AppColors.darkInk4 : AppColors.ink4),
                              ),
                              const SizedBox(height: 20),
                              AppButton(
                                text: 'اختيار ملف للرفع',
                                variant: AppButtonVariant.solid,
                                size: AppButtonSize.md,
                                isLoading: _isProcessing,
                                icon: const Icon(Icons.attach_file, size: 18),
                                onPressed: _pickAndProcessFile,
                              ),
                            ],
                          ),
                          // JSON Tab
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: _jsonController,
                                  maxLines: null,
                                  expands: true,
                                  style: AppTypography.mono(fontSize: 12),
                                  decoration: InputDecoration(
                                    hintText: '{\n  "title": "Exam 1",\n  "questions": [...]\n}',
                                    filled: true,
                                    fillColor: isDark ? AppColors.darkPaper2 : AppColors.paper2,
                                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(4)),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 10),
                              AppButton(
                                text: 'تحقق من الـ JSON',
                                variant: AppButtonVariant.soft,
                                onPressed: _parseManualJson,
                              ),
                            ],
                          ),
                        ],
                      ),
              ),

              if (_statusMessage != null) ...[
                const SizedBox(height: 8),
                Text(
                  _statusMessage!,
                  textAlign: TextAlign.center,
                  style: AppTypography.arabic(fontSize: 12, color: AppColors.alert),
                ),
              ],

              if (_extractedData != null) ...[
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: AppButton(
                        text: 'حفظ البنك في السحابة ✓',
                        variant: AppButtonVariant.solid,
                        size: AppButtonSize.md,
                        isLoading: _isSaving,
                        onPressed: _saveDeckToFirestore,
                      ),
                    ),
                    const SizedBox(width: 8),
                    AppButton(
                      text: 'إلغاء',
                      variant: AppButtonVariant.ghost,
                      size: AppButtonSize.md,
                      onPressed: () => setState(() => _extractedData = null),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPreviewSection(BuildContext context) {
    final title = (_extractedData!['title'] as String?) ?? 'بنك أسئلة';
    final questions = (_extractedData!['questions'] as List?) ?? [];

    return AppCard(
      variant: AppCardVariant.flat,
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              AppTag(text: '${questions.length} QUESTIONS EXTRACTED', variant: AppTagVariant.success),
              const Icon(Icons.check_circle, color: AppColors.success, size: 20),
            ],
          ),
          const SizedBox(height: 8),
          Text(title, style: AppTypography.arabic(fontSize: 15, fontWeight: FontWeight.w700)),
          const AppRule(variant: AppRuleVariant.standard, margin: EdgeInsets.symmetric(vertical: 8)),
          Expanded(
            child: ListView.separated(
              itemCount: questions.take(5).length,
              separatorBuilder: (context, index) => const SizedBox(height: 6),
              itemBuilder: (context, i) {
                final q = questions[i] as Map;
                return Text(
                  '${i + 1}. ${q['question_ar'] ?? q['question'] ?? ''}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppTypography.arabic(fontSize: 12),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

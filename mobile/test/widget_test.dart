import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:med_royale_mobile/core/theme/app_theme.dart';
import 'package:med_royale_mobile/core/widgets/app_button.dart';
import 'package:med_royale_mobile/core/widgets/app_card.dart';
import 'package:med_royale_mobile/core/widgets/app_tag.dart';
import 'package:med_royale_mobile/core/widgets/stat_block.dart';

void main() {
  testWidgets('AppButton renders and triggers callback', (WidgetTester tester) async {
    bool clicked = false;

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: AppButton(
            text: 'اختبار النقر',
            onPressed: () => clicked = true,
          ),
        ),
      ),
    );

    expect(find.text('اختبار النقر'), findsOneWidget);
    await tester.tap(find.text('اختبار النقر'));
    expect(clicked, isTrue);
  });

  testWidgets('AppTag and StatBlock render properly', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        home: const Scaffold(
          body: Column(
            children: [
              AppTag(text: 'DUEL', variant: AppTagVariant.burgundy),
              StatBlock(label: 'Total Score', value: '1420'),
              AppCard(child: Text('Card Content')),
            ],
          ),
        ),
      ),
    );

    expect(find.text('DUEL'), findsOneWidget);
    expect(find.text('TOTAL SCORE'), findsOneWidget);
    expect(find.text('1420'), findsOneWidget);
    expect(find.text('Card Content'), findsOneWidget);
  });
}

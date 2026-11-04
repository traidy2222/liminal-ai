import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/models/harness_settings.dart';
import 'package:liminal_desktop/ui/theme/liminal_theme.dart';
import 'package:liminal_desktop/ui/widgets/liminal_form_field.dart';

void main() {
  testWidgets(
      'an explicit custom provider model can be selected without losing local choices',
      (tester) async {
    const cloud = 'openai/whisper-large-v3-turbo';
    String? saved;
    final field = HarnessSettingsField(
        key: 'AGENT_TRANSCRIBE_MODEL',
        label: 'Transcription mode',
        tabId: 'session_ui',
        subgroupId: 'voice',
        subgroupLabel: 'Voice',
        valueKind: 'enum',
        value: 'local/whisper-large-v3-turbo',
        enumValues: ['local/whisper-large-v3-turbo', 'local/qwen3-asr-1.7b']);
    await tester.pumpWidget(MaterialApp(
        theme: buildLiminalTheme(),
        home: Scaffold(
            body: LiminalHarnessField(
                field: field,
                controller: null,
                onApply: (value) {
                  saved = value;
                }))));
    expect(find.text('Custom provider model'), findsOneWidget);
    await tester.tap(find.text('Custom provider model'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), cloud);
    await tester.tap(find.text('Use custom model'));
    await tester.pumpAndSettle();
    expect(saved, cloud);
    expect(
        tester
            .widget<DropdownButtonFormField<String>>(
                find.byType(DropdownButtonFormField<String>))
            .initialValue,
        cloud);
    expect(tester.takeException(), isNull);
  });
}

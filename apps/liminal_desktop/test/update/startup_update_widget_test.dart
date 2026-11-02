import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/core/update/update_coordinator.dart';
import 'package:liminal_desktop/models/persona_ui_theme.dart';
import 'package:liminal_desktop/ui/screens/boot_screens.dart';
import 'package:liminal_desktop/ui/theme/liminal_theme.dart';

void main() {
  testWidgets(
      'launch download shows progress and allows continuing with the current version',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var skipped = false;
    await tester.pumpWidget(MaterialApp(
        theme: buildLiminalTheme(persona: PersonaUiTheme.liminalDefault),
        home: Scaffold(
            body: Center(
                child: SizedBox(
                    width: 326,
                    child: LaunchUpdateProgress(
                        active: true,
                        state: const UpdateState(
                            phase: UpdatePhase.downloading,
                            downloadProgress: .42),
                        onSkip: () => skipped = true))))));
    expect(find.text('42%'), findsOneWidget);
    await tester.tap(find.text('Open current version'));
    expect(skipped, isTrue);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(MaterialApp(
        theme: buildLiminalTheme(persona: PersonaUiTheme.liminalDefault),
        home: const Scaffold(
            body: LaunchUpdateProgress(
                active: true,
                state: UpdateState(phase: UpdatePhase.applying)))));
    expect(find.text('Installing update…'), findsOneWidget);
    expect(find.text('Open current version'), findsNothing);
  });
}

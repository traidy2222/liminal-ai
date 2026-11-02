import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/models/file_edit_view_state.dart';
import 'package:liminal_desktop/ui/theme/liminal_theme.dart';
import 'package:liminal_desktop/ui/widgets/file_edit_dock.dart';

void main() {
  testWidgets('write completion, failure and interruption replace the writing label', (tester) async {
    Future<void> show(FileEditPhase phase) => tester.pumpWidget(MaterialApp(
      theme: buildLiminalTheme(),
      home: Scaffold(body: FileEditDock(
        view: FileEditViewState(open: true, callId: 'write', toolName: 'write_file',
          path: 'done.txt', content: 'done', charCount: 4, phase: phase,
          incomplete: false, updatedAt: 1),
        expanded: true, onToggleExpanded: () {},
      )),
    ));
    await show(FileEditPhase.writing);
    expect(find.text('writing to disk…'), findsOneWidget);
    await show(FileEditPhase.completed);
    expect(find.text('writing to disk…'), findsNothing);
    expect(find.text('saved'), findsOneWidget);
    expect(find.text('done'), findsOneWidget);
    await show(FileEditPhase.failed);
    expect(find.text('write failed'), findsOneWidget);
    expect(find.text('saved'), findsNothing);
    await show(FileEditPhase.interrupted);
    expect(find.text('completion unconfirmed'), findsOneWidget);
    expect(find.text('writing to disk…'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}

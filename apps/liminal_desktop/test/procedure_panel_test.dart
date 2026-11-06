import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/ui/widgets/procedure_panel.dart';
import 'package:liminal_desktop/ui/theme/liminal_theme.dart';
import 'package:liminal_desktop/core/chat_reducer.dart';
import 'package:liminal_desktop/core/chat_transcript_state.dart';

void main() {
  test('procedure events deduplicate and remain bounded', () {
    var s = ChatTranscriptState.initial;
    for (var n = 0; n < 30; n++) {
      s = reduceChatEvent(s, 'procedure_activity', {
        'action': 'suspended',
        'name': 'Record',
        'reason': 'Changed $n',
        'versionId': 'v',
        'runId': 'r',
      });
    }
    expect(s.procedureActivities.length, 24);
    expect(s.messages, isEmpty);
    s = reduceChatEvent(s, 'procedure_activity', {
      'action': 'suspended',
      'name': 'Record',
      'reason': 'Changed 29',
      'versionId': 'v',
      'runId': 'r',
    });
    expect(s.procedureActivities.length, 24);
    expect(s.procedureActivities.last.label, 'Needs revalidation');
  });
  testWidgets('backend data drives evidence inspection and disable action',
      (tester) async {
    tester.view.physicalSize = const Size(1280, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final calls = <String>[];
    var disabled = false;
    Map<String, dynamic> procedure() => {
          'state': 'active',
          'disabled': disabled,
          'reason': 'Objective contract passed',
          'successes': 1,
          'failures': 0,
          'body': {
            'name': 'Register provider',
            'purpose': 'Create a JSON provider record',
            'versionId': 'version-one',
            'version': 1,
            'applicability': [],
            'preconditions': [],
            'negativeExamples': ['No overwrite'],
            'dependencies': [],
            'missingEvidence': ['General benefit unproven'],
            'explanation': {'kind': 'inferred', 'text': 'Observed repair'},
          },
        };
    Future<Map<String, dynamic>> command(
      String action,
      Map<String, dynamic> data,
    ) async {
      calls.add(action);
      if (action == 'list') {
        return {
          'procedures': [procedure()],
          'contracts': [],
          'episodes': [],
        };
      }
      if (action == 'disable') {
        disabled = data['disabled'] == true;
        return {};
      }
      if (action == 'inspect') {
        return {
          'procedure': procedure(),
          'events': [
            {
              'eventId': 'event-one',
              'kind': 'verification',
              'ok': false,
              'data': 'Wrong kind',
            }
          ],
          'validations': [],
          'history': [],
        };
      }
      if (action == 'evidence') {
        return {
          'content': 'Objective failure: expected provider, observed component',
          'offset': 0,
          'totalCharacters': 62,
          'nextOffset': null,
        };
      }
      return {};
    }

    await tester.pumpWidget(
      MaterialApp(
        theme: buildLiminalTheme(),
        home: Scaffold(body: ProcedurePanel(command: command)),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Register provider'));
    await tester.pumpAndSettle();
    expect(find.text('Verified for recorded conditions'), findsNWidgets(2));
    await tester.ensureVisible(find.text('Disable retrieval'));
    await tester.tap(find.text('Disable retrieval'));
    await tester.pumpAndSettle();
    expect(calls, contains('disable'));
    expect(find.text('Enable retrieval'), findsOneWidget);
    await tester.ensureVisible(find.textContaining('Inspect verification'));
    await tester.tap(find.textContaining('Inspect verification'));
    await tester.pumpAndSettle();
    expect(
      find.text('Objective failure: expected provider, observed component'),
      findsOneWidget,
    );
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
  testWidgets(
      'a delayed verifier preview cannot replace the file currently selected by the user',
      (tester) async {
    final pending = Completer<Map<String, dynamic>>();
    Future<Map<String, dynamic>> command(
      String action,
      Map<String, dynamic> payload,
    ) async {
      if (action == 'preview_contract') return pending.future;
      return {'procedures': [], 'contracts': [], 'episodes': []};
    }

    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: ProcedurePanel(command: command))),
    );
    await tester.pumpAndSettle();
    final path =
        find.widgetWithText(TextField, 'Convention file inside this workspace');
    await tester.enterText(path, 'old.json');
    await tester.tap(find.text('Inspect checks'));
    await tester.pump();
    await tester.enterText(path, 'new.json');
    pending.complete({
      'sourcePath': 'old.json',
      'sourceHash': 'old',
      'body': {'name': 'Old checks'},
    });
    await tester.pumpAndSettle();
    expect(find.text('Use these inspected checks'), findsNothing);
  });
}

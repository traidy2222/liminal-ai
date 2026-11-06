import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/core/chat_reducer.dart';
import 'package:liminal_desktop/core/chat_transcript_state.dart';
import 'package:liminal_desktop/core/transcript_grouping.dart';
import 'package:liminal_desktop/state/message_models.dart';
import 'package:liminal_desktop/ui/theme/liminal_theme.dart';
import 'package:liminal_desktop/ui/widgets/working_activity_panel.dart';

void main() {
  testWidgets('completed tool activity replaces Working with Finished', (
    tester,
  ) async {
    var state = applyUserMessage(ChatTranscriptState.initial, 'Compare hotels');
    state = reduceChatEvent(state, 'tool_start', {
      'callId': 'read',
      'name': 'read_file',
    });
    Future<void> show() => tester.pumpWidget(
      MaterialApp(
        theme: buildLiminalTheme(),
        home: Scaffold(
          body: WorkingActivityPanel(
            entries: state.messages.whereType<ToolCallMessage>().toList(),
            verboseTools: false,
            personaLabel: 'Jarvis',
          ),
        ),
      ),
    );
    await show();
    expect(find.text('Working'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    state = reduceChatEvent(state, 'tool_result', {
      'callId': 'read',
      'name': 'read_file',
      'result': {'ok': true, 'output': 'Three dated rooms'},
    });
    state = reduceChatEvent(state, 'turn_end', {});
    await show();
    await tester.pumpAndSettle();
    expect(state.busy, isFalse);
    expect(
      state.messages.whereType<ToolCallMessage>().single.status,
      ToolCallStatus.done,
    );
    expect(find.text('Finished'), findsOneWidget);
    expect(find.text('Working'), findsNothing);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(tester.takeException(), isNull);
  });

  for (final terminal in ['turn_end', 'error']) {
    test(
      '$terminal clears unfinished reasoning and tools without claiming tool success',
      () {
        final state = reduceChatEvent(
          ChatTranscriptState(
            busy: true,
            messages: [
              ThinkMessage(
                callId: 'think',
                streaming: true,
                content: 'Partial thought',
                argsPreview: '{"content":',
              ),
              ReasonMessage(
                callId: 'reason',
                streaming: true,
                inference: 'Partial inference',
                confidence: '0.5',
              ),
              ToolCallMessage(
                callId: 'tool',
                name: 'browser_open',
                status: ToolCallStatus.running,
              ),
            ],
          ),
          terminal,
          {'message': 'Connection closed'},
        );
        expect(state.busy, isFalse);
        expect(
          state.messages.whereType<ThinkMessage>().single.streaming,
          isFalse,
        );
        expect(
          state.messages.whereType<ThinkMessage>().single.content,
          'Partial thought',
        );
        expect(
          state.messages.whereType<ReasonMessage>().single.streaming,
          isFalse,
        );
        expect(
          state.messages.whereType<ReasonMessage>().single.confidence,
          '0.5',
        );
        final summary = summarizeActivityGroup(state.messages);
        expect(summary.isActive, isFalse);
        expect(summary.runningCount, 0);
        expect(summary.errorCount, 1);
      },
    );
  }
}

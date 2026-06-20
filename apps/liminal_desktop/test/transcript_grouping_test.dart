import 'package:flutter_test/flutter_test.dart';

import 'package:liminal_desktop/core/transcript_grouping.dart';
import 'package:liminal_desktop/state/message_models.dart';

void main() {
  test('groupTranscriptActivity keeps conversation rows separate', () {
    final msgs = [
      UserMessage('hi'),
      AssistantMessage(text: 'On it', streaming: false),
      ToolCallMessage(callId: '1', name: 'read_file', status: ToolCallStatus.done),
      ToolCallMessage(callId: '2', name: 'grep_file', status: ToolCallStatus.running),
      AssistantMessage(text: 'Done', streaming: false),
    ];
    final segments = groupTranscriptActivity(msgs);
    expect(segments.length, 4);
    expect(segments[0], isA<TranscriptMessageSegment>());
    expect((segments[0] as TranscriptMessageSegment).entry, isA<UserMessage>());
    expect(segments[1], isA<TranscriptMessageSegment>());
    expect(segments[2], isA<TranscriptActivityGroupSegment>());
    expect((segments[2] as TranscriptActivityGroupSegment).entries.length, 2);
    expect(segments[3], isA<TranscriptMessageSegment>());
  });

  test('summarizeActivityGroup reports running tool', () {
    final summary = summarizeActivityGroup([
      ToolCallMessage(callId: '1', name: 'vault_ingest', status: ToolCallStatus.running),
      ToolCallMessage(callId: '2', name: 'read_file', status: ToolCallStatus.done),
    ]);
    expect(summary.toolCount, 2);
    expect(summary.runningCount, 1);
    expect(summary.activeToolName, 'vault_ingest');
    expect(summary.isActive, isTrue);
    expect(
      activityGroupSubtitle(summary),
      '2 tools · 1 running · vault_ingest',
    );
  });
}

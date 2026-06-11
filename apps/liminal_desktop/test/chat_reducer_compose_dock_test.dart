import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/core/chat_reducer.dart';
import 'package:liminal_desktop/core/chat_transcript_state.dart';

void main() {
  test('tool_delta opens compose dock when fileEditView was missing', () {
    var state = ChatTranscriptState.initial;
    state = reduceChatEvent(state, 'tool_start', {
      'callId': 'call_write_1',
      'name': 'write_file',
    });
    expect(state.fileEditView?.callId, 'call_write_1');

    state = state.copyWith(clearFileEditView: true);
    expect(state.fileEditView, isNull);

    state = reduceChatEvent(state, 'tool_delta', {
      'callId': 'call_write_1',
      'argsDelta': '{"path":"src/a.ts","content":"export const x = 1;',
    });

    expect(state.fileEditView, isNotNull);
    expect(state.fileEditView!.callId, 'call_write_1');
    expect(state.fileEditView!.content, contains('export const x'));
    expect(state.fileEditView!.incomplete, isTrue);
  });

  test('compose_preview opens dock without tool_start', () {
    var state = ChatTranscriptState.initial;
    state = reduceChatEvent(state, 'compose_preview', {
      'callId': 'call_compose_1',
      'name': 'write_file',
      'argsJson': '{"path":"live.ts","content":"partial"}',
      'compose': {
        'kind': 'file',
        'path': 'live.ts',
        'content': 'partial',
        'charCount': 7,
        'lineCount': 1,
        'incomplete': true,
      },
    });

    expect(state.fileEditView, isNotNull);
    expect(state.fileEditView!.open, isTrue);
    expect(state.fileEditView!.content, 'partial');
    expect(state.fileEditView!.path, 'live.ts');
  });

  test('tool_delta uses harness compose wire preview', () {
    var state = ChatTranscriptState.initial;
    state = reduceChatEvent(state, 'tool_start', {
      'callId': 'call_write_wire',
      'name': 'write_file',
    });

    state = reduceChatEvent(state, 'tool_delta', {
      'callId': 'call_write_wire',
      'argsDelta': 'ignored',
      'argsJson': '{"path":"wire.ts","content":"streaming from harness"}',
      'name': 'write_file',
      'compose': {
        'kind': 'file',
        'path': 'wire.ts',
        'content': 'streaming from harness',
        'charCount': 23,
        'lineCount': 1,
        'incomplete': true,
      },
    });

    expect(state.fileEditView!.content, 'streaming from harness');
    expect(state.fileEditView!.path, 'wire.ts');
    expect(state.fileEditView!.incomplete, isTrue);
  });

  test('tool_result opens compose dock when streaming events were missed', () {
    var state = ChatTranscriptState.initial;
    state = reduceChatEvent(state, 'tool_result', {
      'callId': 'call_late_1',
      'name': 'write_file',
      'ok': true,
      'output': 'Wrote src/late.ts',
      'args': {'path': 'src/late.ts', 'content': 'export const done = true;'},
    });

    expect(state.fileEditView, isNotNull);
    expect(state.fileEditView!.open, isTrue);
    expect(state.fileEditView!.content, contains('export const done'));
    expect(state.fileEditView!.path, 'src/late.ts');
    expect(state.fileEditView!.incomplete, isFalse);
  });

  test('tool_delta refreshes compose dock for matching write_file stream', () {
    var state = ChatTranscriptState.initial;
    state = reduceChatEvent(state, 'tool_start', {
      'callId': 'call_write_2',
      'name': 'write_file',
    });
    state = reduceChatEvent(state, 'tool_delta', {
      'callId': 'call_write_2',
      'argsDelta': '{"path":"b.ts","content":"line one\\n',
    });

    expect(state.fileEditView, isNotNull);
    expect(state.fileEditView!.content, contains('line one'));
    expect(state.fileEditView!.path, 'b.ts');
  });
}

import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/core/chat_reducer.dart';
import 'package:liminal_desktop/core/chat_transcript_state.dart';
import 'package:liminal_desktop/models/file_edit_view_state.dart';
import 'package:liminal_desktop/state/message_models.dart';

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
  ChatTranscriptState writingState() {
    var state =
        reduceChatEvent(ChatTranscriptState.initial, 'harness_running', {});
    state = reduceChatEvent(
        state, 'tool_start', {'callId': 'write', 'name': 'write_file'});
    state = reduceChatEvent(state, 'tool_delta', {
      'callId': 'write',
      'argsDelta': '{"path":"done.txt","content":"done"}'
    });
    return reduceChatEvent(
        state, 'tool_executing', {'callId': 'write', 'name': 'write_file'});
  }

  test('successful write is saved immediately and remains saved after turn end',
      () {
    var state = writingState();
    expect(state.fileEditView!.phase, FileEditPhase.writing);
    state = reduceChatEvent(state, 'tool_result', {
      'callId': 'write',
      'name': 'write_file',
      'result': {'ok': true, 'output': 'Wrote done.txt'}
    });
    expect(state.fileEditView!.phase, FileEditPhase.completed);
    expect(state.fileEditView!.incomplete, isFalse);
    expect(state.fileEditView!.content, 'done');
    state = reduceChatEvent(state, 'turn_end', {});
    expect(state.fileEditView!.phase, FileEditPhase.completed);
    expect(state.busy, isFalse);
  });

  test('failed write stops writing and does not claim the file was saved', () {
    var state = writingState();
    state = reduceChatEvent(state, 'tool_result', {
      'callId': 'write',
      'name': 'write_file',
      'result': {'ok': false, 'error': 'Permission denied'}
    });
    expect(state.fileEditView!.phase, FileEditPhase.failed);
    expect(state.fileEditView!.incomplete, isFalse);
    state = reduceChatEvent(state, 'turn_end', {});
    expect(state.fileEditView!.phase, FileEditPhase.failed);
  });

  for (final event in ['turn_end', 'error']) {
    test(
        '$event closes orphan tool status without inventing a successful write',
        () {
      final state =
          reduceChatEvent(writingState(), event, {'message': 'Disconnected'});
      expect(state.fileEditView!.phase, FileEditPhase.interrupted);
      expect(state.fileEditView!.incomplete, isFalse);
      expect(state.messages.whereType<ToolCallMessage>().single.status,
          ToolCallStatus.error);
      expect(state.busy, isFalse);
    });
  }

  test('late stream, approval and start events cannot reopen a completed write',
      () {
    var state = reduceChatEvent(writingState(), 'tool_result',
        {'callId': 'write', 'name': 'write_file', 'ok': true});
    for (final event in [
      'tool_start',
      'tool_delta',
      'compose_preview',
      'tool_executing',
      'tool_approval',
      'approval_decision'
    ]) {
      state = reduceChatEvent(state, event, {
        'callId': 'write',
        'name': 'write_file',
        'argsDelta': 'late',
        'decision': 'approve',
        'compose': {'content': 'late', 'incomplete': true}
      });
      expect(state.fileEditView!.phase, FileEditPhase.completed, reason: event);
      expect(state.fileEditView!.content, 'done', reason: event);
      expect(state.messages.whereType<ToolCallMessage>().single.status,
          ToolCallStatus.done,
          reason: event);
    }
  });

  test('parallel result does not replace another active write preview', () {
    var state = writingState();
    state = reduceChatEvent(
        state, 'tool_start', {'callId': 'other', 'name': 'write_file'});
    state = reduceChatEvent(state, 'tool_delta', {
      'callId': 'other',
      'argsDelta': '{"path":"other.txt","content":"other"}'
    });
    state = reduceChatEvent(state, 'tool_result',
        {'callId': 'write', 'name': 'write_file', 'ok': true});
    expect(state.fileEditView!.callId, 'other');
    expect(state.fileEditView!.isTerminal, isFalse);
  });
}

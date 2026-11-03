import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/core/chat_reducer.dart';
import 'package:liminal_desktop/core/chat_transcript_state.dart';
import 'package:liminal_desktop/state/message_models.dart';
import 'package:liminal_desktop/core/transcript_grouping.dart';
import 'package:liminal_desktop/core/chat_visibility.dart';

void main() {
  test('weather updates and final reply stay around their tool batches', () {
    var state =
        applyUserMessage(ChatTranscriptState.initial, 'Please get the weather');
    state = reduceChatEvent(state, 'text',
        {'delta': 'Getting the weather now.', 'channel': 'user'});
    for (final id in ['one', 'two']) {
      state = reduceChatEvent(
          state, 'tool_start', {'callId': id, 'name': 'weather_lookup'});
      state = reduceChatEvent(state, 'tool_result', {
        'callId': id,
        'name': 'weather_lookup',
        'ok': true,
        'output': 'Forecast'
      });
    }
    state = reduceChatEvent(state, 'text',
        {'delta': 'Checking the updated forecast.', 'channel': 'user'});
    state = reduceChatEvent(
        state, 'tool_start', {'callId': 'three', 'name': 'weather_lookup'});
    state = reduceChatEvent(state, 'tool_result', {
      'callId': 'three',
      'name': 'weather_lookup',
      'ok': true,
      'output': 'Verified forecast'
    });
    state = reduceChatEvent(
        state, 'text', {'delta': 'The final forecast.', 'channel': 'user'});
    state = reduceChatEvent(state, 'turn_end', {});
    final assistants = state.messages.whereType<AssistantMessage>().toList();
    expect(assistants.map((m) => m.text).toList(), [
      'Getting the weather now.',
      'Checking the updated forecast.',
      'The final forecast.'
    ]);
    expect(assistants.every((m) => !m.streaming), isTrue);
    final visible = visibleChatMessages(state.messages, showRawHarness: false);
    expect(
        groupTranscriptActivity(visible)
            .whereType<TranscriptActivityGroupSegment>()
            .map((g) => g.entries.whereType<ToolCallMessage>().length)
            .toList(),
        [2, 1]);
  });
  test('narration after tool_start opens a separate assistant segment', () {
    var state =
        applyUserMessage(ChatTranscriptState.initial, 'lookup US in vault');
    state = reduceChatEvent(state, 'text', {
      'delta': 'Searching the vault',
      'channel': 'user',
    });
    state = reduceChatEvent(state, 'tool_start', {
      'callId': 'call-1',
      'name': 'vault_search',
    });
    state = reduceChatEvent(state, 'text', {
      'delta': ' for United States…',
      'channel': 'user',
    });

    final assistants = state.messages.whereType<AssistantMessage>().toList();
    expect(assistants.length, 2);
    expect(assistants.first.text, 'Searching the vault');
    expect(assistants.first.streaming, isFalse);
    expect(assistants.last.text, ' for United States…');
    expect(assistants.last.streaming, isTrue);
  });

  test('tool_start seals the preceding assistant segment', () {
    var state = reduceChatEvent(
      ChatTranscriptState(
        busy: true,
        messages: [
          UserMessage('hi'),
          AssistantMessage(text: 'Working on it', streaming: true),
        ],
      ),
      'tool_start',
      {'callId': 'c1', 'name': 'vault_ingest_entities'},
    );

    final assistant = state.messages.whereType<AssistantMessage>().single;
    expect(assistant.streaming, isFalse);
    expect(assistant.text, 'Working on it');
  });
}

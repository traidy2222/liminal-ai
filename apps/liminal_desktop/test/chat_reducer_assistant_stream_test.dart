import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/core/chat_reducer.dart';
import 'package:liminal_desktop/core/chat_transcript_state.dart';
import 'package:liminal_desktop/state/message_models.dart';

void main() {
  test('assistant narration continues after tool_start in same turn', () {
    var state = applyUserMessage(ChatTranscriptState.initial, 'lookup US in vault');
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
    expect(assistants.length, 1);
    expect(assistants.first.text, 'Searching the vault for United States…');
    expect(assistants.first.streaming, isTrue);
  });

  test('tool_start does not freeze assistant streaming', () {
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
    expect(assistant.streaming, isTrue);
    expect(assistant.text, 'Working on it');
  });
}

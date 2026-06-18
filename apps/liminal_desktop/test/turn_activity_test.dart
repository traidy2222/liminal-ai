import 'package:flutter_test/flutter_test.dart';

import 'package:liminal_desktop/core/turn_activity.dart';
import 'package:liminal_desktop/state/message_models.dart';

void main() {
  test('chatAwaitingVisibleActivity true when busy after user only', () {
    final msgs = [UserMessage('hello')];
    expect(chatAwaitingVisibleActivity(msgs, busy: true), isTrue);
  });

  test('chatAwaitingVisibleActivity false when tool row exists', () {
    final msgs = [
      UserMessage('hello'),
      ToolCallMessage(
        callId: '1',
        name: 'youtube_rest_get_channel',
        status: ToolCallStatus.running,
      ),
    ];
    expect(chatAwaitingVisibleActivity(msgs, busy: true), isFalse);
  });

  test('chatAwaitingVisibleActivity false when assistant replied', () {
    final msgs = [
      UserMessage('hello'),
      AssistantMessage(text: 'Here are your stats', streaming: false),
    ];
    expect(chatAwaitingVisibleActivity(msgs, busy: true), isFalse);
  });
}

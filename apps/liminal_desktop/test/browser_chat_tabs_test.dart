import 'package:flutter_test/flutter_test.dart';
import '../lib/browser/browser_chat_tabs.dart';

void main() {
  test('chat switching and background tabs retain independent selection', () {
    final state = BrowserChatTabs()..activeChatId = 'a';
    final tabs = [
      {'sessionId': 'a1', 'ownerTaskId': 'a'},
      {'sessionId': 'a2', 'ownerTaskId': 'a'},
      {'sessionId': 'b1', 'ownerTaskId': 'b'},
    ];
    state.apply({'tabs': tabs});
    state.select('a', 'a1');
    state.activeChatId = 'b';
    expect(state.tabs.map((t) => t['sessionId']), ['b1']);
    state.select('b', 'b1');
    state.activeChatId = 'a';
    expect(state.selectedTabId, 'a1');
    state.apply({
      'tabs': [
        ...tabs,
        {'sessionId': 'b2', 'ownerTaskId': 'b'},
      ],
      'selectedTabs': {'a': 'a1', 'b': 'b2'},
    });
    expect(state.selectedTabId, 'a1');
    expect(state.tabs.length, 2);
    state.select('a', 'b2');
    expect(state.selectedTabId, 'a1');
    state.activeChatId = 'b';
    expect(state.selectedTabId, 'b2');
    state.apply({'tabs': tabs});
    expect(state.selectedTabId, 'b1');
    state.activeChatId = 'a';
    expect(state.selectedTabId, 'a1');
    state.activeChatId = null;
    expect(state.tabs, isEmpty);
    expect(state.selectedTabId, isNull);
  });
}

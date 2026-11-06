/// Tab metadata is chat-owned; native controllers and login storage stay shared.
class BrowserChatTabs {
  String? activeChatId;
  List<Map<String, dynamic>> allTabs = [];
  final Map<String, String> _selected = {};

  List<Map<String, dynamic>> get tabs => activeChatId == null
      ? []
      : allTabs.where((t) => t['ownerTaskId'] == activeChatId).toList();

  String? get selectedTabId {
    final visible = tabs;
    final selected = _selected[activeChatId];
    return visible.any((t) => t['sessionId'] == selected)
        ? selected
        : visible.isEmpty
        ? null
        : visible.last['sessionId'] as String;
  }

  void select(String chatId, String id) {
    if (allTabs.any(
      (t) => t['sessionId'] == id && t['ownerTaskId'] == chatId,
    )) {
      _selected[chatId] = id;
    }
  }

  void apply(Map<String, dynamic> state) {
    allTabs = (state['tabs'] as List? ?? [])
        .map((t) => Map<String, dynamic>.from(t as Map))
        .toList();
    final saved = state['selectedTabs'];
    if (saved is Map) {
      for (final entry in saved.entries) {
        if (entry.key is String && entry.value is String) {
          select(entry.key as String, entry.value as String);
        }
      }
    }
    _selected.removeWhere(
      (chat, id) =>
          !allTabs.any((t) => t['ownerTaskId'] == chat && t['sessionId'] == id),
    );
  }
}

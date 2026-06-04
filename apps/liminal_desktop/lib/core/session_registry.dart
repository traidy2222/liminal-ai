import '../state/chat_session_controller.dart';

/// Owns per-chat transcript controllers; chat events do not fan out to the app shell.
class SessionRegistry {
  final Map<String, ChatSessionController> _sessions = {};

  ChatSessionController sessionFor(String chatId) {
    return _sessions.putIfAbsent(
      chatId,
      () => ChatSessionController(chatId: chatId),
    );
  }

  ChatSessionController? get(String chatId) => _sessions[chatId];

  void remove(String chatId) {
    _sessions.remove(chatId)?.dispose();
  }

  void dispatch(String chatId, String event, Map<String, dynamic> data) {
    sessionFor(chatId).applyServerEvent(event, data);
  }

  void disposeAll() {
    for (final s in _sessions.values) {
      s.dispose();
    }
    _sessions.clear();
  }
}

/// Identifies a live, user-started conversation with answer text. No content is
/// retained here; replay, reasoning, background turns, errors and cancels do not
/// qualify. Completion is an activity signal, not a judgement of answer quality.
class UsageTurnTracker {
  final Map<String, bool> _pending = {};

  void begin(String chatId) => _pending.putIfAbsent(chatId, () => false);
  void cancel(String chatId) => _pending.remove(chatId);
  void clear() => _pending.clear();

  bool observe(String chatId, String event, Map<String, dynamic> data) {
    if (!_pending.containsKey(chatId)) return false;
    if (event == 'error') {
      cancel(chatId);
      return false;
    }
    if (event == 'text' &&
        data['channel'] != 'trace' &&
        data['channel'] != 'reasoning' &&
        data['delta'] is String &&
        (data['delta'] as String).trim().isNotEmpty) {
      _pending[chatId] = true;
    }
    if (event == 'turn_end') return _pending.remove(chatId) == true;
    return false;
  }
}

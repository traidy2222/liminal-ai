import 'package:flutter/foundation.dart';

import '../core/chat_reducer.dart' as chat_reducer;
import '../core/chat_transcript_state.dart';
import 'message_models.dart';

/// Per-chat transcript + gates; notifies only this chat's listeners.
class ChatSessionController extends ChangeNotifier {
  ChatSessionController({required this.chatId});

  final String chatId;
  ChatTranscriptState _state = ChatTranscriptState.initial;

  List<MessageEntry> get messages => _state.messages;
  bool get busy => _state.busy;
  PendingApproval? get pendingApproval => _state.pendingApproval;
  PendingAskUser? get pendingAskUser => _state.pendingAskUser;
  String? get connectionError => _state.connectionError;
  String? get personaBootstrapProgress => _state.personaBootstrapProgress;
  String? get personaBootstrapStage => _state.personaBootstrapStage;

  void applyUserMessage(
    String text, {
    List<UserAttachmentPreview> attachmentPreviews = const [],
  }) {
    _state = chat_reducer.applyUserMessage(
      _state,
      text,
      attachmentPreviews: attachmentPreviews,
    );
    notifyListeners();
  }

  void applyServerEvent(String event, Map<String, dynamic> data) {
    final next = chat_reducer.reduceChatEvent(_state, event, data);
    if (identical(next, _state)) return;
    _state = next;
    notifyListeners();
  }

  void setConnectionError(String message) {
    _state = _state.copyWith(busy: false, connectionError: message);
    notifyListeners();
  }

  void clearTranscript() {
    _state = ChatTranscriptState.initial;
    notifyListeners();
  }
}

/// @deprecated Use [ChatSessionController].
typedef ChatSession = ChatSessionController;

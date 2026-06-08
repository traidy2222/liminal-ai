import 'package:flutter/foundation.dart';

import '../core/chat_reducer.dart' as chat_reducer;
import '../core/chat_transcript_state.dart';
import '../models/browser_view_state.dart';
import '../models/file_edit_view_state.dart';
import 'message_models.dart';

/// Per-chat transcript + gates; notifies only this chat's listeners.
class ChatSessionController extends ChangeNotifier {
  ChatSessionController({required this.chatId});

  final String chatId;
  ChatTranscriptState _state = ChatTranscriptState.initial;

  /// User-controlled collapse for the embedded browser dock.
  bool browserDockExpanded = true;
  /// User-controlled collapse for the live file-edit dock.
  bool fileEditDockExpanded = true;

  List<MessageEntry> get messages => _state.messages;
  bool get busy => _state.busy;
  List<PendingApproval> get pendingApprovals => _state.pendingApprovals;
  PendingApproval? get pendingApproval => _state.pendingApproval;
  int get pendingApprovalCount => _state.pendingApprovals.length;
  PendingAskUser? get pendingAskUser => _state.pendingAskUser;
  String? get connectionError => _state.connectionError;
  String? get personaBootstrapProgress => _state.personaBootstrapProgress;
  String? get personaBootstrapStage => _state.personaBootstrapStage;
  BrowserViewState? get browserView => _state.browserView;
  FileEditViewState? get fileEditView => _state.fileEditView;

  void toggleBrowserDock() {
    browserDockExpanded = !browserDockExpanded;
    notifyListeners();
  }

  void toggleFileEditDock() {
    fileEditDockExpanded = !fileEditDockExpanded;
    notifyListeners();
  }

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
    final prevBrowserOpen = _state.browserView?.open ?? false;
    final prevFileEditOpen = _state.fileEditView?.open ?? false;
    final next = chat_reducer.reduceChatEvent(_state, event, data);
    if (identical(next, _state)) return;
    _state = next;
    final nextBrowserOpen = _state.browserView?.open ?? false;
    final nextFileEditOpen = _state.fileEditView?.open ?? false;
    if (!prevBrowserOpen && nextBrowserOpen) {
      browserDockExpanded = true;
    }
    if (!prevFileEditOpen && nextFileEditOpen) {
      fileEditDockExpanded = true;
    }
    notifyListeners();
  }

  void setConnectionError(String message) {
    _state = _state.copyWith(busy: false, connectionError: message);
    notifyListeners();
  }

  void clearTranscript() {
    _state = ChatTranscriptState.initial;
    browserDockExpanded = true;
    fileEditDockExpanded = true;
    notifyListeners();
  }
}

/// @deprecated Use [ChatSessionController].
typedef ChatSession = ChatSessionController;

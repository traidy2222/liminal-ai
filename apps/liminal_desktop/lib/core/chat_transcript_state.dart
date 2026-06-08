import '../models/browser_view_state.dart';
import '../models/file_edit_view_state.dart';
import '../state/message_models.dart';

/// Immutable per-chat transcript + interactive gates (reducer input/output).
class ChatTranscriptState {
  const ChatTranscriptState({
    this.messages = const [],
    this.busy = false,
    this.pendingApprovals = const [],
    this.pendingAskUser,
    this.connectionError,
    this.personaBootstrapProgress,
    this.personaBootstrapStage,
    this.browserView,
    this.fileEditView,
  });

  final List<MessageEntry> messages;
  final bool busy;
  /// FIFO queue — parallel tool batches can emit multiple `tool_approval` events.
  final List<PendingApproval> pendingApprovals;
  final PendingAskUser? pendingAskUser;
  final String? connectionError;
  final String? personaBootstrapProgress;
  final String? personaBootstrapStage;
  final BrowserViewState? browserView;
  final FileEditViewState? fileEditView;

  PendingApproval? get pendingApproval =>
      pendingApprovals.isNotEmpty ? pendingApprovals.first : null;

  static const initial = ChatTranscriptState();

  ChatTranscriptState copyWith({
    List<MessageEntry>? messages,
    bool? busy,
    List<PendingApproval>? pendingApprovals,
    bool clearPendingApprovals = false,
    PendingAskUser? pendingAskUser,
    bool clearPendingAskUser = false,
    String? connectionError,
    bool clearConnectionError = false,
    String? personaBootstrapProgress,
    String? personaBootstrapStage,
    BrowserViewState? browserView,
    bool clearBrowserView = false,
    FileEditViewState? fileEditView,
    bool clearFileEditView = false,
  }) {
    return ChatTranscriptState(
      messages: messages ?? this.messages,
      busy: busy ?? this.busy,
      pendingApprovals: clearPendingApprovals
          ? const []
          : (pendingApprovals ?? this.pendingApprovals),
      pendingAskUser:
          clearPendingAskUser ? null : (pendingAskUser ?? this.pendingAskUser),
      connectionError: clearConnectionError
          ? null
          : (connectionError ?? this.connectionError),
      personaBootstrapProgress:
          personaBootstrapProgress ?? this.personaBootstrapProgress,
      personaBootstrapStage: personaBootstrapStage ?? this.personaBootstrapStage,
      browserView: clearBrowserView ? null : (browserView ?? this.browserView),
      fileEditView: clearFileEditView ? null : (fileEditView ?? this.fileEditView),
    );
  }
}

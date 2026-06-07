import '../models/browser_view_state.dart';
import '../state/message_models.dart';

/// Immutable per-chat transcript + interactive gates (reducer input/output).
class ChatTranscriptState {
  const ChatTranscriptState({
    this.messages = const [],
    this.busy = false,
    this.pendingApproval,
    this.pendingAskUser,
    this.connectionError,
    this.personaBootstrapProgress,
    this.personaBootstrapStage,
    this.browserView,
  });

  final List<MessageEntry> messages;
  final bool busy;
  final PendingApproval? pendingApproval;
  final PendingAskUser? pendingAskUser;
  final String? connectionError;
  final String? personaBootstrapProgress;
  final String? personaBootstrapStage;
  final BrowserViewState? browserView;

  static const initial = ChatTranscriptState();

  ChatTranscriptState copyWith({
    List<MessageEntry>? messages,
    bool? busy,
    PendingApproval? pendingApproval,
    bool clearPendingApproval = false,
    PendingAskUser? pendingAskUser,
    bool clearPendingAskUser = false,
    String? connectionError,
    bool clearConnectionError = false,
    String? personaBootstrapProgress,
    String? personaBootstrapStage,
    BrowserViewState? browserView,
    bool clearBrowserView = false,
  }) {
    return ChatTranscriptState(
      messages: messages ?? this.messages,
      busy: busy ?? this.busy,
      pendingApproval:
          clearPendingApproval ? null : (pendingApproval ?? this.pendingApproval),
      pendingAskUser:
          clearPendingAskUser ? null : (pendingAskUser ?? this.pendingAskUser),
      connectionError: clearConnectionError
          ? null
          : (connectionError ?? this.connectionError),
      personaBootstrapProgress:
          personaBootstrapProgress ?? this.personaBootstrapProgress,
      personaBootstrapStage: personaBootstrapStage ?? this.personaBootstrapStage,
      browserView: clearBrowserView ? null : (browserView ?? this.browserView),
    );
  }
}

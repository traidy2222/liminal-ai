import 'package:flutter/foundation.dart';

import '../core/chat_reducer.dart' as chat_reducer;
import '../core/chat_transcript_state.dart';
import '../core/streaming_write_preview.dart';
import '../models/browser_view_state.dart';
import '../models/file_edit_view_state.dart';
import '../models/terminal_panel_state.dart';
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
  /// User-controlled collapse for the Ghostty terminal dock.
  bool terminalDockExpanded = true;
  /// User-dragged terminal body height (px); null = default fraction of screen.
  double? terminalBodyHeight;
  /// User-dragged right-rail width (px); null = default layout width.
  double? dockRailWidth;
  TerminalPanelState? terminalPanel;

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

  void toggleTerminalDock() {
    terminalDockExpanded = !terminalDockExpanded;
    notifyListeners();
  }

  void setTerminalPanel(TerminalPanelState? panel) {
    terminalPanel = panel;
    if (panel != null && panel.open) terminalDockExpanded = true;
    notifyListeners();
  }

  void upsertTerminalTab(TerminalTabState tab, {bool focus = true}) {
    final panel = terminalPanel;
    if (panel == null) {
      terminalPanel = TerminalPanelState(
        tabs: [tab],
        activeSessionId: tab.sessionId,
        open: true,
      );
    } else {
      final idx = panel.tabs.indexWhere((t) => t.sessionId == tab.sessionId);
      final tabs = List<TerminalTabState>.from(panel.tabs);
      if (idx >= 0) {
        tabs[idx] = tab;
      } else {
        tabs.add(tab);
      }
      terminalPanel = panel.copyWith(
        tabs: tabs,
        activeSessionId: focus ? tab.sessionId : panel.activeSessionId,
        open: true,
      );
    }
    if (focus) terminalDockExpanded = true;
    notifyListeners();
  }

  void removeTerminalTab(String sessionId) {
    final panel = terminalPanel;
    if (panel == null) return;
    final tabs = panel.tabs.where((t) => t.sessionId != sessionId).toList();
    if (tabs.isEmpty) {
      terminalPanel = null;
    } else {
      final nextActive = panel.activeSessionId == sessionId
          ? tabs.last.sessionId
          : panel.activeSessionId;
      terminalPanel = panel.copyWith(tabs: tabs, activeSessionId: nextActive);
    }
    notifyListeners();
  }

  void setActiveTerminalTab(String sessionId) {
    final panel = terminalPanel;
    if (panel == null) return;
    terminalPanel = panel.copyWith(activeSessionId: sessionId, open: true);
    terminalDockExpanded = true;
    notifyListeners();
  }

  void toggleBrowserDock() {
    browserDockExpanded = !browserDockExpanded;
    notifyListeners();
  }

  void toggleFileEditDock() {
    fileEditDockExpanded = !fileEditDockExpanded;
    notifyListeners();
  }

  void setTerminalBodyHeight(double height) {
    terminalBodyHeight = height;
    notifyListeners();
  }

  void adjustTerminalBodyHeight(
    double delta, {
    required double min,
    required double max,
    required double fallback,
  }) {
    final base = terminalBodyHeight ?? fallback;
    terminalBodyHeight = (base + delta).clamp(min, max);
    notifyListeners();
  }

  void setDockRailWidth(double width) {
    dockRailWidth = width;
    notifyListeners();
  }

  void adjustDockRailWidth(
    double delta, {
    required double min,
    required double max,
    required double fallback,
  }) {
    final base = dockRailWidth ?? fallback;
    dockRailWidth = (base + delta).clamp(min, max);
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
      dockRailWidth = null;
    }
    if (event == 'tool_delta' ||
        event == 'compose_preview' ||
        event == 'tool_start' ||
        (event == 'tool_result' &&
            isComposeDockTool(data['name'] as String? ?? ''))) {
      if (nextFileEditOpen) {
        fileEditDockExpanded = true;
        dockRailWidth = null;
      }
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

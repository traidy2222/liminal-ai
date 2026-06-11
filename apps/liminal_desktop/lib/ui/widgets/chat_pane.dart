import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../models/persona_ui_layout.dart';
import '../../protocol/chat_summary.dart';
import '../../state/app_controller.dart';
import '../../state/chat_session_controller.dart';
import '../../models/persona_ui_theme.dart';
import '../design_system/liminal_design_system.dart';
import '../theme/liminal_theme_extension.dart';
import 'approval_sheet.dart';
import 'ask_user_sheet.dart';
import 'browser_dock.dart';
import 'terminal_dock.dart';
import 'file_edit_dock.dart';
import 'panel_resize_handle.dart';
import 'composer.dart';
import 'orchestrator_panel.dart';
import 'sticky_message_list.dart';

/// One chat column in a single- or multi-pane layout.
class ChatPane extends StatelessWidget {
  const ChatPane({
    super.key,
    required this.chatId,
    required this.host,
    required this.session,
    required this.layout,
    required this.focused,
    this.title,
    this.busy = false,
    this.onFocus,
    this.onClose,
    this.showClose = false,
    this.emptyTitle = 'Ready when you are',
    this.emptyBody = 'Ask anything, or start with a task.',
  });

  final String chatId;
  final AppController host;
  final ChatSessionController session;
  final PersonaLayoutSpec layout;
  final bool focused;
  final String? title;
  final bool busy;
  final VoidCallback? onFocus;
  final VoidCallback? onClose;
  final bool showClose;
  final String emptyTitle;
  final String emptyBody;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Material(
      color: focused ? Colors.transparent : lim.panel.withValues(alpha: 0.35),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _PaneHeader(
            title: title ?? 'Chat',
            focused: focused,
            busy: busy,
            showClose: showClose,
            onFocus: onFocus,
            onClose: onClose,
            onToggleTerminal: focused
                ? () => unawaited(host.toggleChatTerminal(chatId))
                : null,
            terminalOpen: session.terminalPanel?.hasTabs ?? false,
          ),
          if (host.isOrchestratorChat(chatId))
            ListenableBuilder(
              listenable: host,
              builder: (context, _) {
                final snap = host.orchestration;
                if (snap.isIdle && snap.workers.isEmpty) {
                  return const SizedBox.shrink();
                }
                return Padding(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      OrchestratorMissionBanner(snapshot: snap),
                      if (snap.workerChatIds.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: TextButton.icon(
                            onPressed: host.openOrchestrationWorkspace,
                            icon: const Icon(Icons.open_in_new, size: 16),
                            label: const Text('View worker chats'),
                          ),
                        ),
                      ],
                    ],
                  ),
                );
              },
            ),
          Expanded(
            child: ListenableBuilder(
              listenable: Listenable.merge([session, host]),
              builder: (context, _) {
                final browser = session.browserView;
                final fileEdit = session.fileEditView;
                final transcript = session.messages.isEmpty
                    ? LiminalEmptyState(
                        title: emptyTitle,
                        body: emptyBody,
                        icon: Icons.chat_bubble_outline,
                        compact: true,
                      )
                    : _buildTranscript(context);

                final showBrowser = focused && browser != null && browser.open;
                final showFileEdit = fileEdit != null && fileEdit.open;
                if (!showBrowser && !showFileEdit) {
                  return transcript;
                }

                final screenW = MediaQuery.sizeOf(context).width;
                final defaultRailW = _dockRailWidth(
                  session,
                  showBrowser,
                  showFileEdit,
                  screenW,
                );
                final railExpanded = defaultRailW > _dockCollapsedWidth;
                final maxRail = math.min(_dockExpandedWidth, screenW * 0.48);
                const minRail = _dockMinExpandedWidth;
                final railW = railExpanded
                    ? (session.dockRailWidth ?? defaultRailW).clamp(minRail, maxRail)
                    : defaultRailW;

                return Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(child: transcript),
                    if (railExpanded)
                      PanelResizeHandle(
                        axis: PanelResizeAxis.horizontal,
                        onDragDelta: (delta) => session.adjustDockRailWidth(
                          delta,
                          min: minRail,
                          max: maxRail,
                          fallback: defaultRailW,
                        ),
                      ),
                    SizedBox(
                      width: railW,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (showFileEdit)
                            Expanded(
                              child: FileEditDock(
                                view: fileEdit,
                                expanded: session.fileEditDockExpanded,
                                onToggleExpanded: session.toggleFileEditDock,
                              ),
                            ),
                          if (showBrowser)
                            Expanded(
                              child: BrowserDock(
                                view: browser,
                                expanded: session.browserDockExpanded,
                                onToggleExpanded: session.toggleBrowserDock,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
          ListenableBuilder(
            listenable: session,
            builder: (context, _) {
              if (session.pendingApproval != null) {
                return ApprovalSheet(
                  pending: session.pendingApproval!,
                  queueIndex: 1,
                  queueTotal: session.pendingApprovalCount,
                  onApprove: () => host.resolveApproval('approve', chatId: chatId),
                  onReject: () => host.resolveApproval('reject', chatId: chatId),
                );
              }
              if (session.pendingAskUser != null) {
                return AskUserSheet(
                  pending: session.pendingAskUser!,
                  onSubmit: (answer) =>
                      host.resolveAskUser(answer, chatId: chatId),
                );
              }
              return const SizedBox.shrink();
            },
          ),
          ListenableBuilder(
            listenable: Listenable.merge([session, host]),
            builder: (context, _) {
              final theme =
                  host.config?.resolvedTheme ?? PersonaUiTheme.liminalDefault;
              return ChatComposerShell(
                theme: theme,
                layout: layout,
                child: Composer(
                  enabled: true,
                  busy: session.busy,
                  config: host.config,
                  dictation: focused ? host.dictation : null,
                  speechOutput: focused ? host.speechOutput : null,
                  dictationNotice: focused ? host.dictationNotice : null,
                  onDismissDictationNotice:
                      focused ? host.dismissDictationNotice : null,
                  onDictationAutoSend:
                      focused ? host.handleDictationAutoSend : null,
                  onSend: (text, attachments) {
                    unawaited(
                      host.sendMessage(
                        text,
                        chatId: chatId,
                        attachments: attachments,
                        liveDictation:
                            focused && host.dictationSessionActive,
                      ),
                    );
                  },
                  onAbort: () => host.abortTurn(chatId: chatId),
                ),
              );
            },
          ),
          ListenableBuilder(
            listenable: session,
            builder: (context, _) {
              final panel = session.terminalPanel;
              final showTerminal =
                  focused && panel != null && panel.hasTabs;
              if (!showTerminal) return const SizedBox.shrink();
              final screenH = MediaQuery.sizeOf(context).height;
              const minTermH = 120.0;
              final maxTermH = screenH * 0.65;
              final defaultTermH =
                  (screenH * 0.34).clamp(200.0, 560.0);
              final termH = (session.terminalBodyHeight ?? defaultTermH)
                  .clamp(minTermH, maxTermH);
              return TerminalDock(
                panel: panel,
                expanded: session.terminalDockExpanded,
                onToggleExpanded: session.toggleTerminalDock,
                bodyHeight: termH,
                onResizeBodyHeight: session.terminalDockExpanded
                    ? (delta) => session.adjustTerminalBodyHeight(
                          delta,
                          min: minTermH,
                          max: maxTermH,
                          fallback: defaultTermH,
                        )
                    : null,
                onSelectTab: session.setActiveTerminalTab,
                onCloseTab: (sid) =>
                    unawaited(host.closeChatTerminalTab(chatId, sid)),
                onNewTab: () =>
                    unawaited(host.openChatTerminalTab(chatId, forceNew: true)),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildTranscript(BuildContext context) {
    final list = StickyMessageList(
      messages: session.messages,
      showRawHarness: host.showRawHarness,
      personaLabel: host.config?.personaDisplayLabel,
    );
    if (layout.transcriptMaxWidth <= 0 || !focused) return list;
    return Center(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: layout.transcriptMaxWidth),
        child: list,
      ),
    );
  }
}

class _PaneHeader extends StatelessWidget {
  const _PaneHeader({
    required this.title,
    required this.focused,
    required this.busy,
    required this.showClose,
    this.onFocus,
    this.onClose,
    this.onToggleTerminal,
    this.terminalOpen = false,
  });

  final String title;
  final bool focused;
  final bool busy;
  final bool showClose;
  final VoidCallback? onFocus;
  final VoidCallback? onClose;
  final VoidCallback? onToggleTerminal;
  final bool terminalOpen;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return LiminalInteractive(
      enabled: !focused && onFocus != null,
      onPressed: onFocus,
      borderRadius: BorderRadius.zero,
      builder: (context, hovered, _) {
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: focused || hovered
                    ? lim.accent.withValues(alpha: 0.45)
                    : lim.border,
                width: focused ? 2 : 1,
              ),
            ),
          ),
          child: Row(
            children: [
              if (busy)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Icon(Icons.bolt, size: 16, color: lim.accent),
                ),
              Expanded(
                child: Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        color: focused ? lim.accent : lim.text,
                        fontWeight: focused ? FontWeight.w600 : FontWeight.w500,
                      ),
                ),
              ),
              if (onToggleTerminal != null)
                LiminalIconButton(
                  icon: Icons.terminal,
                  tooltip: terminalOpen ? 'Close terminal' : 'Open terminal',
                  size: 18,
                  selected: terminalOpen,
                  onPressed: onToggleTerminal,
                ),
              if (showClose && onClose != null)
                LiminalIconButton(
                  icon: Icons.close,
                  tooltip: 'Close pane',
                  size: 18,
                  onPressed: onClose,
                ),
            ],
          ),
        );
      },
    );
  }
}

const _dockExpandedWidth = 420.0;
const _dockCollapsedWidth = 44.0;
const _dockMinExpandedWidth = 260.0;

double _dockRailWidth(
  ChatSessionController session,
  bool showBrowser,
  bool showFileEdit,
  double screenWidth,
) {
  final maxRail = math.min(_dockExpandedWidth, screenWidth * 0.48);
  const minRail = _dockMinExpandedWidth;

  var width = 0.0;
  if (showFileEdit) {
    width = session.fileEditDockExpanded ? maxRail : _dockCollapsedWidth;
  }
  if (showBrowser) {
    final browserWidth =
        session.browserDockExpanded ? maxRail : _dockCollapsedWidth;
    if (browserWidth > width) width = browserWidth;
  }

  if (width > _dockCollapsedWidth) {
    width = width.clamp(minRail, maxRail);
  }
  return width;
}

String? chatTitleFor(List<ChatSummary> chats, String chatId) {
  for (final c in chats) {
    if (c.chatId == chatId) return c.title;
  }
  return null;
}

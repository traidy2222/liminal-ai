import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_scope.dart';
import '../../models/persona_ui_layout.dart';
import '../../models/persona_ui_theme.dart';
import '../../routing/routes.dart';
import '../../state/app_controller.dart';
import '../theme/liminal_theme_extension.dart';
import '../widgets/approval_sheet.dart';
import '../widgets/ask_user_sheet.dart';
import '../widgets/chat_drawer.dart';
import '../../state/chat_session_controller.dart';
import '../widgets/browser_dock.dart';
import '../widgets/composer.dart';
import '../widgets/liminal_app_bar.dart';
import '../widgets/liminal_shell.dart';
import '../widgets/sticky_message_list.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final host = AppScope.watch(context);
    final chatId = host.activeChatId;
    final session = chatId != null ? host.sessionFor(chatId) : null;
    final lim = LiminalTheme.of(context);
    final copy = host.config?.resolvedCopy;
    final layout = PersonaLayoutSpec.fromTheme(
      host.config?.resolvedTheme ?? PersonaUiTheme.liminalDefault,
    );

    return LiminalShell(
      drawer: ChatDrawer(
        chats: host.chats,
        activeChatId: host.activeChatId,
        onSelect: host.activateChat,
        onNewChat: () => host.createChat(),
        onDelete: host.deleteChat,
      ),
      appBar: AppBar(
        title: LiminalAppBarTitle(
          title: host.config?.personaDisplayLabel ?? 'Liminal',
          subtitle: _subtitle(host),
        ),
        actions: [
          ListenableBuilder(
            listenable: session ?? _EmptyListenable(),
            builder: (context, _) {
              if (session?.busy != true) return const SizedBox.shrink();
              return Padding(
                padding: const EdgeInsets.only(right: 4),
                child: Icon(Icons.bolt, color: lim.accent, size: 20),
              );
            },
          ),
          IconButton(
            tooltip: host.showRawHarness
                ? 'Hide harness internals (trace, working state, retries)'
                : 'Show harness internals (tools always visible)',
            onPressed: host.toggleShowRawHarness,
            icon: Icon(
              host.showRawHarness ? Icons.data_object : Icons.data_object_outlined,
              color: host.showRawHarness ? lim.accent : lim.textMuted,
            ),
          ),
          PopupMenuButton<String>(
            tooltip: 'More',
            onSelected: (v) {
              switch (v) {
                case 'settings':
                  context.push(AppRoutes.settings);
                case 'raw':
                  host.toggleShowRawHarness();
                case 'reset':
                  if (chatId != null) host.resetSession();
                case 'rebootstrap':
                  if (chatId != null) host.resetSession(rebootstrap: true);
              }
            },
            itemBuilder: (context) => [
              PopupMenuItem(
                value: 'raw',
                child: Text(
                  host.showRawHarness ? 'Harness internals ●' : 'Harness internals ○',
                ),
              ),
              const PopupMenuItem(value: 'settings', child: Text('Settings')),
              const PopupMenuItem(value: 'reset', child: Text('Reset session')),
              const PopupMenuItem(
                value: 'rebootstrap',
                child: Text('Reset persona & rebootstrap'),
              ),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: session == null
                ? Center(
                    child: Text(
                      'No active chat',
                      style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                            color: lim.textMuted,
                          ),
                    ),
                  )
                : ListenableBuilder(
                    listenable: Listenable.merge([session, host]),
                    builder: (context, _) {
                      final browser = session.browserView;
                      final chatPane = session.messages.isEmpty
                          ? _EmptyState(
                              title: copy?.emptyTitle ?? 'Ready when you are',
                              body: copy?.emptyBody ??
                                  'Ask anything, or start with a task.',
                            )
                          : _buildTranscript(context, session, host, layout);

                      if (browser == null || !browser.open) {
                        return chatPane;
                      }

                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Expanded(child: chatPane),
                          BrowserDock(
                            view: browser,
                            expanded: session.browserDockExpanded,
                            onToggleExpanded: session.toggleBrowserDock,
                          ),
                        ],
                      );
                    },
                  ),
          ),
          ListenableBuilder(
            listenable: session ?? _EmptyListenable(),
            builder: (context, _) {
              if (session?.pendingApproval != null) {
                return ApprovalSheet(
                  pending: session!.pendingApproval!,
                  onApprove: () => host.resolveApproval('approve'),
                  onReject: () => host.resolveApproval('reject'),
                );
              }
              if (session?.pendingAskUser != null) {
                return AskUserSheet(
                  pending: session!.pendingAskUser!,
                  onSubmit: host.resolveAskUser,
                );
              }
              return const SizedBox.shrink();
            },
          ),
          ListenableBuilder(
            listenable: session ?? _EmptyListenable(),
            builder: (context, _) => Composer(
              enabled: chatId != null,
              busy: session?.busy ?? false,
              config: host.config,
              dictation: host.dictation,
              speechOutput: host.speechOutput,
              dictationNotice: host.dictationNotice,
              onDismissDictationNotice: host.dismissDictationNotice,
              onDictationAutoSend: host.handleDictationAutoSend,
              onSend: (text, attachments) {
                unawaited(
                  host.sendMessage(
                    text,
                    attachments: attachments,
                    liveDictation: host.dictationSessionActive,
                  ),
                );
              },
              onAbort: host.abortTurn,
            ),
          ),
        ],
      ),
    );
  }

  String? _subtitle(AppController host) {
    final active =
        host.chats.where((x) => x.chatId == host.activeChatId).toList();
    if (active.isEmpty) return null;
    return active.first.title;
  }

  Widget _buildTranscript(
    BuildContext context,
    ChatSessionController session,
    AppController host,
    PersonaLayoutSpec layout,
  ) {
    final list = StickyMessageList(
      messages: session.messages,
      showRawHarness: host.showRawHarness,
    );
    if (layout.transcriptMaxWidth <= 0) return list;
    return Center(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: layout.transcriptMaxWidth),
        child: list,
      ),
    );
  }
}

class _EmptyListenable extends ChangeNotifier {}

/// Persona-voiced empty conversation state.
class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              title,
              textAlign: TextAlign.center,
              style: theme.textTheme.headlineMedium?.copyWith(color: lim.text),
            ),
            const SizedBox(height: 10),
            Text(
              body,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(color: lim.textMuted, height: 1.4),
            ),
          ],
        ),
      ),
    );
  }
}

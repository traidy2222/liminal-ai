import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_scope.dart';
import '../../routing/routes.dart';
import '../../state/app_controller.dart';
import '../theme/liminal_theme_extension.dart';
import '../widgets/approval_sheet.dart';
import '../widgets/ask_user_sheet.dart';
import '../widgets/chat_drawer.dart';
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
                    builder: (context, _) => StickyMessageList(
                      messages: session.messages,
                      showRawHarness: host.showRawHarness,
                    ),
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
              onSend: (text, attachments) => host.sendMessage(
                    text,
                    attachments: attachments,
                  ),
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
}

class _EmptyListenable extends ChangeNotifier {}

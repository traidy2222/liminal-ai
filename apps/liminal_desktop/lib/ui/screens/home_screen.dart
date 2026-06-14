import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_scope.dart';
import '../../models/persona_ui_layout.dart';
import '../../models/persona_ui_theme.dart';
import '../../routing/routes.dart';
import '../../protocol/chat_summary.dart';
import '../../state/app_controller.dart';
import '../design_system/liminal_design_system.dart';
import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';
import '../widgets/chat_drawer.dart';
import '../widgets/chat_pane.dart';
import '../widgets/liminal_app_bar.dart';
import '../widgets/liminal_error_boundary.dart';
import '../widgets/liminal_shell.dart';

/// Liminal chat workspace (multi-pane, up to [AppController.maxVisibleChats]). Opened from [VireonHubScreen].
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _ensureWorkspace());
  }

  Future<void> _ensureWorkspace() async {
    final host = AppScope.of(context);
    if (host.inChatWorkspace && host.visibleChatIds.isNotEmpty) return;

    if (host.activeChatId != null) {
      await host.enterChatWorkspace(host.activeChatId!);
      return;
    }
    if (host.chats.isNotEmpty) {
      final sorted = List.of(host.chats)
        ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
      await host.enterChatWorkspace(sorted.first.chatId);
      return;
    }
    if (!mounted) return;
    host.returnToHub();
    context.go(AppRoutes.hub);
  }

  void _goHome(AppController host) {
    host.returnToHub();
    context.go(AppRoutes.hub);
  }

  @override
  Widget build(BuildContext context) {
    final host = AppScope.watch(context);
    final chatId = host.activeChatId;
    final lim = LiminalTheme.of(context);
    final copy = host.config?.resolvedCopy;
    final personaTheme =
        host.config?.resolvedTheme ?? PersonaUiTheme.liminalDefault;
    final layout = PersonaLayoutSpec.fromTheme(personaTheme);
    final shellStyle = PersonaShellStyle.fromTheme(personaTheme);
    final panes = host.visibleChatIds;
    final paneListenables = [
      host,
      ...panes.map(host.sessionFor),
    ];

    return LiminalShell(
      drawer: ChatDrawer(
        chats: host.chats,
        activeChatId: host.activeChatId,
        visibleChatIds: host.visibleChatIds,
        onHome: () => _goHome(host),
        onSelect: host.enterChatWorkspace,
        onOpenBeside: host.openChatBeside,
        onNewChat: () async {
          final id = await host.createChat();
          if (id != null) await host.enterChatWorkspace(id);
        },
        onDelete: host.deleteChat,
      ),
      appBar: AppBar(
        backgroundColor: shellStyle.appBarBackground(context),
        surfaceTintColor: Colors.transparent,
        shape: shellStyle.appBarBottomSide(context) != null
            ? RoundedRectangleBorder(
                side: shellStyle.appBarBottomSide(context)!,
              )
            : null,
        centerTitle: shellStyle.headerCentered,
        leading: Builder(
          builder: (context) => LiminalIconButton(
            icon: Icons.menu,
            tooltip: 'All chats',
            onPressed: () => Scaffold.of(context).openDrawer(),
          ),
        ),
        title: LiminalAppBarTitle(
          title: host.config?.personaDisplayLabel ?? 'Liminal',
          subtitle: _subtitle(host),
        ),
        actions: [
          LiminalIconButton(
            icon: Icons.home_outlined,
            tooltip: 'Back to home',
            onPressed: () => _goHome(host),
          ),
          ListenableBuilder(
            listenable: Listenable.merge(paneListenables),
            builder: (context, _) {
              final anyBusy =
                  panes.any((id) => host.sessionFor(id).busy);
              if (!anyBusy) return const SizedBox.shrink();
              return Padding(
                padding: const EdgeInsets.only(right: 4),
                child: Icon(Icons.bolt, color: lim.accent, size: 20),
              );
            },
          ),
          LiminalIconButton(
            tooltip: host.showRawHarness
                ? 'Hide harness internals (trace, working state, retries)'
                : 'Show harness internals (tools always visible)',
            onPressed: host.toggleShowRawHarness,
            icon: host.showRawHarness ? Icons.data_object : Icons.data_object_outlined,
            selected: host.showRawHarness,
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
      body: panes.isEmpty
          ? const LiminalEmptyState(
              title: 'Opening chat…',
              compact: true,
            )
          : LiminalErrorBoundary(
              child: panes.length == 1
                  ? _SafeChatPane(
                      chatId: panes.first,
                      host: host,
                      layout: layout,
                      chatIdParam: chatId,
                      copy: copy,
                      chats: host.chats,
                    )
                  : panes.length == 2
                      ? Row(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: _paneRowChildren(
                            panes: panes,
                            host: host,
                            layout: layout,
                            chatId: chatId,
                            lim: lim,
                            copy: copy,
                            expand: true,
                          ),
                        )
                      : SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: SizedBox(
                            height: MediaQuery.sizeOf(context).height,
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: _paneRowChildren(
                                panes: panes,
                                host: host,
                                layout: layout,
                                chatId: chatId,
                                lim: lim,
                                copy: copy,
                                expand: false,
                                paneWidth: 380,
                              ),
                            ),
                          ),
                        ),
            ),
    );
  }

  static const _scrollPaneWidth = 380.0;

  List<Widget> _paneRowChildren({
    required List<String> panes,
    required AppController host,
    required PersonaLayoutSpec layout,
    required String? chatId,
    required LiminalTokens lim,
    required dynamic copy,
    required bool expand,
    double paneWidth = _scrollPaneWidth,
  }) {
    final children = <Widget>[];
    for (var i = 0; i < panes.length; i++) {
      if (i > 0) {
        children.add(
          VerticalDivider(
            width: 1,
            thickness: 1,
            color: lim.border,
          ),
        );
      }
      final pane = ChatPane(
        chatId: panes[i],
        host: host,
        session: host.sessionFor(panes[i]),
        layout: layout,
        focused: panes[i] == chatId,
        title: chatTitleFor(host.chats, panes[i]),
        busy: host.sessionFor(panes[i]).busy,
        showClose: true,
        onFocus: () => host.focusChat(panes[i]),
        onClose: () => host.closeChatPane(panes[i]),
        emptyTitle: copy?.emptyTitle ?? 'Ready when you are',
        emptyBody:
            copy?.emptyBody ?? 'Ask anything, or start with a task.',
      );
      if (expand) {
        children.add(Expanded(child: pane));
      } else {
        children.add(SizedBox(width: paneWidth, child: pane));
      }
    }
    return children;
  }

  String? _subtitle(AppController host) {
    if (host.visibleChatIds.length > 1) {
      return '${host.visibleChatIds.length} chats open';
    }
    final active =
        host.chats.where((x) => x.chatId == host.activeChatId).toList();
    if (active.isEmpty) return null;
    return active.first.title;
  }
}

class _SafeChatPane extends StatelessWidget {
  const _SafeChatPane({
    required this.chatId,
    required this.host,
    required this.layout,
    required this.chatIdParam,
    required this.copy,
    required this.chats,
  });

  final String chatId;
  final AppController host;
  final PersonaLayoutSpec layout;
  final String? chatIdParam;
  final dynamic copy;
  final List<ChatSummary> chats;

  @override
  Widget build(BuildContext context) {
    return ChatPane(
      chatId: chatId,
      host: host,
      session: host.sessionFor(chatId),
      layout: layout,
      focused: true,
      title: chatTitleFor(chats, chatId),
      busy: host.sessionFor(chatId).busy,
      emptyTitle: copy?.emptyTitle ?? 'Ready when you are',
      emptyBody: copy?.emptyBody ?? 'Ask anything, or start with a task.',
    );
  }
}

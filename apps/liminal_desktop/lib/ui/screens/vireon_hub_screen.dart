import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_scope.dart';
import '../../protocol/chat_summary.dart';
import '../../routing/routes.dart';
import '../../models/vireon_account.dart';
import '../../state/app_controller.dart';
import '../layout/liminal_breakpoints.dart';
import '../theme/liminal_theme_extension.dart';
import '../widgets/integration_brand_icon.dart';
import '../widgets/liminal_page_canvas.dart';
import '../widgets/liminal_section.dart';
import '../widgets/liminal_shell.dart';
import '../widgets/orchestrator_panel.dart';
import '../widgets/vireon_brand.dart';

class VireonHubScreen extends StatefulWidget {
  const VireonHubScreen({super.key});

  @override
  State<VireonHubScreen> createState() => _VireonHubScreenState();
}

class _VireonHubScreenState extends State<VireonHubScreen> {
  bool _openingChat = false;
  Timer? _orchestrationPoll;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final host = AppScope.of(context);
      host.returnToHub();
      unawaited(Future.wait([
        host.loadVireonAccount(),
        host.loadOrchestration(),
        host.loadIntegrations(),
      ]));
      _syncOrchestrationPoll(host);
    });
  }

  @override
  void dispose() {
    _orchestrationPoll?.cancel();
    super.dispose();
  }

  void _syncOrchestrationPoll(AppController host) {
    if (host.orchestration.isActive) {
      _orchestrationPoll ??= Timer.periodic(const Duration(seconds: 2), (_) {
        unawaited(AppScope.of(context).loadOrchestration());
      });
    } else {
      _orchestrationPoll?.cancel();
      _orchestrationPoll = null;
    }
  }

  Future<void> _viewOrchestrationChats(AppController host) async {
    if (_openingChat) return;
    setState(() => _openingChat = true);
    try {
      await host.openOrchestrationWorkspace();
      if (mounted) context.go(AppRoutes.chat);
    } finally {
      if (mounted) setState(() => _openingChat = false);
    }
  }

  Future<void> _openOrchestrator(AppController host) async {
    if (_openingChat) return;
    setState(() => _openingChat = true);
    try {
      final chatId = await host.openOrchestratorChat();
      if (mounted && chatId != null) context.go(AppRoutes.chat);
    } finally {
      if (mounted) setState(() => _openingChat = false);
    }
  }

  Future<void> _openChat(AppController host, String chatId) async {
    if (_openingChat) return;
    setState(() => _openingChat = true);
    try {
      await host.enterChatWorkspace(chatId);
      if (mounted) context.go(AppRoutes.chat);
    } finally {
      if (mounted) setState(() => _openingChat = false);
    }
  }

  Future<void> _newChat(AppController host) async {
    if (_openingChat) return;
    setState(() => _openingChat = true);
    try {
      final chatId = await host.createChat();
      if (!mounted) return;
      if (chatId == null) return;
      await host.enterChatWorkspace(chatId);
      if (mounted) context.go(AppRoutes.chat);
    } finally {
      if (mounted) setState(() => _openingChat = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final host = AppScope.watch(context);
    _syncOrchestrationPoll(host);
    final lim = LiminalTheme.of(context);
    final recent = _recentChats(host.chats);
    final greeting = _greeting(host);

    return LiminalShell(
      appBar: AppBar(
        title: const VireonBrandMark(compact: true, tagline: 'Desktop'),
        actions: [
          IconButton(
            tooltip: 'Settings',
            onPressed: () => context.push(AppRoutes.settings),
            icon: Icon(Icons.settings_outlined, color: lim.textMuted),
          ),
        ],
      ),
      body: LiminalPageCanvas(
        child: SingleChildScrollView(
          padding: LiminalBreakpoints.pagePadding(context),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                greeting,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      color: lim.text,
                      fontWeight: FontWeight.w600,
                    ),
              ),
              const SizedBox(height: 6),
              Text(
                'Pick a workspace below — Liminal chats, tools, and more live here.',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: lim.textMuted,
                      height: 1.4,
                    ),
              ),
              if (host.vireonAccount.connected && host.vireonAccount.email != null) ...[
                const SizedBox(height: 10),
                _AccountChip(snapshot: host.vireonAccount),
              ],
              const SizedBox(height: 28),
              LiminalSection(
                title: 'Mission Control',
                subtitle:
                    'Talk to your orchestrator — describe missions, spawn worker chats, and get merged results.',
                trailing: FilledButton.icon(
                  onPressed: _openingChat ? null : () => _openOrchestrator(host),
                  icon: const Icon(Icons.hub_outlined, size: 18),
                  label: const Text('Open chat'),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (host.orchestration.isActive ||
                        host.orchestration.status == 'completed' ||
                        host.orchestration.status == 'failed' ||
                        host.orchestration.status == 'stopped') ...[
                      OrchestratorMissionBanner(snapshot: host.orchestration),
                      if (host.orchestration.workerChatIds.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: OutlinedButton.icon(
                            onPressed: _openingChat
                                ? null
                                : () => _viewOrchestrationChats(host),
                            icon: const Icon(Icons.open_in_new, size: 18),
                            label: const Text('View worker chats'),
                          ),
                        ),
                      ],
                    ] else
                      Text(
                        'Example: “Research static site hosts and write a one-page decision memo.”',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: lim.textMuted,
                              height: 1.4,
                            ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              LiminalSection(
                title: 'Liminal',
                subtitle: 'Agent harness, tools, and multi-chat workspaces',
                trailing: FilledButton.icon(
                  onPressed: _openingChat ? null : () => _newChat(host),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('New chat'),
                ),
                child: recent.isEmpty
                    ? _EmptyChatsHint(onCreate: () => _newChat(host))
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          for (final chat in recent)
                            _ChatRow(
                              chat: chat,
                              busy: _openingChat,
                              onTap: () => _openChat(host, chat.chatId),
                            ),
                          if (host.chats.length > recent.length)
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text(
                                '${host.chats.length - recent.length} more in chat view',
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                      color: lim.textDim,
                                    ),
                              ),
                            ),
                        ],
                      ),
              ),
              const SizedBox(height: 24),
              LiminalSection(
                title: 'Integrations',
                subtitle: 'Connect Google, Microsoft, GitHub, Xero, and more for your agent.',
                trailing: FilledButton.icon(
                  onPressed: () => context.push(AppRoutes.integrations),
                  icon: const Icon(Icons.extension_outlined, size: 18),
                  label: const Text('Manage'),
                ),
                child: _IntegrationsHubSummary(host: host),
              ),
              const SizedBox(height: 24),
              Text(
                'More coming soon',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: lim.textMuted,
                      fontWeight: FontWeight.w600,
                    ),
              ),
              const SizedBox(height: 12),
              LayoutBuilder(
                builder: (context, constraints) {
                  final w = constraints.maxWidth;
                  final cols = w >= LiminalBreakpoints.medium ? 2 : 1;
                  final tiles = const [
                    _HubModuleTile(
                      icon: Icons.widgets_outlined,
                      title: 'Apps',
                      subtitle: 'Desktop widgets & sidecar apps',
                      comingSoon: true,
                    ),
                    _HubModuleTile(
                      icon: Icons.science_outlined,
                      title: 'Bench',
                      subtitle: 'Scenario evals & CI gates',
                      comingSoon: true,
                    ),
                  ];
                  if (cols == 1) {
                    return Column(
                      children: [
                        for (final t in tiles) ...[
                          t,
                          const SizedBox(height: 10),
                        ],
                      ],
                    );
                  }
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (var i = 0; i < tiles.length; i++) ...[
                        if (i > 0) const SizedBox(width: 12),
                        Expanded(child: tiles[i]),
                      ],
                    ],
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _greeting(AppController host) {
    final email = host.vireonAccount.email;
    if (email != null && email.isNotEmpty) {
      final name = email.split('@').first;
      return 'Welcome back, $name';
    }
    return 'Welcome to Vireon';
  }

  List<ChatSummary> _recentChats(List<ChatSummary> chats) {
    final sorted = List<ChatSummary>.from(chats)
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return sorted.take(6).toList();
  }
}

class _AccountChip extends StatelessWidget {
  const _AccountChip({required this.snapshot});

  final VireonAccountSnapshot snapshot;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final tier = snapshot.tier;
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: lim.surface.withValues(alpha: 0.55),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: lim.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.verified_user_outlined, size: 16, color: lim.accent),
            const SizedBox(width: 6),
            Text(
              '${snapshot.email} · $tier',
              style: Theme.of(context).textTheme.labelMedium?.copyWith(color: lim.textMuted),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyChatsHint extends StatelessWidget {
  const _EmptyChatsHint({required this.onCreate});

  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'No chats yet. Start one when you are ready to work with your agent.',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: lim.textMuted,
                  height: 1.4,
                ),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: onCreate,
            icon: const Icon(Icons.chat_bubble_outline, size: 18),
            label: const Text('Start first chat'),
          ),
        ],
      ),
    );
  }
}

class _ChatRow extends StatelessWidget {
  const _ChatRow({
    required this.chat,
    required this.onTap,
    required this.busy,
  });

  final ChatSummary chat;
  final VoidCallback onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: busy ? null : onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
          child: Row(
            children: [
              Icon(
                chat.busy ? Icons.bolt : Icons.chat_bubble_outline,
                size: 18,
                color: chat.busy ? lim.accent : lim.textDim,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      chat.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(color: lim.text),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      chat.busy ? 'Running…' : chat.workspaceRoot,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: LiminalTheme.mono(
                        context,
                        fontSize: 11,
                        color: lim.textDim,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: lim.textMuted, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

class _IntegrationsHubSummary extends StatelessWidget {
  const _IntegrationsHubSummary({required this.host});

  final AppController host;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final snap = host.integrations;
    if (host.integrationsLoading && snap.connections.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: LinearProgressIndicator(),
      );
    }
    final connectedCount = [
      snap.googleConnected,
      snap.microsoftConnected,
      snap.githubConnected,
      snap.xeroConnected,
      snap.slackConnected,
      snap.linearConnected,
    ].where((v) => v).length;
    final connCount = snap.connections.length;
    final parts = <String>[
      if (snap.googleConnected) 'Google',
      if (snap.microsoftConnected) 'Microsoft',
      if (snap.githubConnected) 'GitHub',
      if (snap.xeroConnected) 'Xero',
      if (snap.slackConnected) 'Slack',
      if (snap.linearConnected) 'Linear',
      if (snap.customMcp.isNotEmpty) '${snap.customMcp.length} custom',
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: const [
            IntegrationBrandIcon(id: IntegrationBrandId.google, size: 36),
            IntegrationBrandIcon(id: IntegrationBrandId.microsoft, size: 36),
            IntegrationBrandIcon(id: IntegrationBrandId.xero, size: 36),
            IntegrationBrandIcon(id: IntegrationBrandId.slack, size: 36),
            IntegrationBrandIcon(id: IntegrationBrandId.linear, size: 36),
            IntegrationBrandIcon(id: IntegrationBrandId.notion, size: 36),
            IntegrationBrandIcon(id: IntegrationBrandId.github, size: 36),
          ],
        ),
        const SizedBox(height: 10),
        Text(
          parts.isEmpty
              ? 'No apps connected yet — link email, files, code, or accounting in one tap.'
              : '${connectedCount > 0 ? "Connected: " : ""}${parts.join(", ")}',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: lim.textMuted,
                height: 1.4,
              ),
        ),
        if (connCount > 0)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              '$connCount active connection${connCount == 1 ? "" : "s"}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: lim.textDim),
            ),
          ),
      ],
    );
  }
}

class _HubModuleTile extends StatelessWidget {
  const _HubModuleTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.comingSoon = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool comingSoon;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Opacity(
      opacity: comingSoon ? 0.72 : 1,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: lim.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(lim.radius),
          border: Border.all(color: lim.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, color: lim.textMuted, size: 22),
                const Spacer(),
                if (comingSoon)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: lim.panel,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: lim.border),
                    ),
                    child: Text(
                      'Soon',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: lim.textDim,
                          ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              title,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: lim.text,
                    fontWeight: FontWeight.w600,
                  ),
            ),
            const SizedBox(height: 4),
            Text(
              subtitle,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: lim.textMuted,
                    height: 1.35,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

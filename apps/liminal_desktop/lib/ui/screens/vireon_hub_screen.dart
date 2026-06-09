import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_scope.dart';
import '../../core/connection_phase.dart';
import '../../models/integrations_snapshot.dart';
import '../../models/orchestration_snapshot.dart';
import '../../models/vireon_account.dart';
import '../../protocol/chat_summary.dart';
import '../../routing/routes.dart';
import '../../state/app_controller.dart';
import '../design_system/liminal_design_system.dart';
import '../layout/liminal_breakpoints.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import '../widgets/integration_brand_icon.dart';
import '../widgets/liminal_page_canvas.dart';
import '../widgets/liminal_shell.dart';
import '../widgets/orchestrator_panel.dart';
import '../widgets/vireon_brand.dart';
import 'hub/hub_format.dart';

class VireonHubScreen extends StatefulWidget {
  const VireonHubScreen({super.key});

  @override
  State<VireonHubScreen> createState() => _VireonHubScreenState();
}

class _VireonHubScreenState extends State<VireonHubScreen> {
  bool _openingChat = false;
  bool _refreshing = false;
  bool _showAllChats = false;
  Timer? _orchestrationPoll;
  final _chatSearch = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final host = AppScope.of(context);
      host.returnToHub();
      unawaited(_refreshHub(host, silent: true));
      _syncOrchestrationPoll(host);
    });
  }

  @override
  void dispose() {
    _orchestrationPoll?.cancel();
    _chatSearch.dispose();
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

  Future<void> _refreshHub(AppController host, {bool silent = false}) async {
    if (_refreshing) return;
    if (!silent) setState(() => _refreshing = true);
    try {
      await Future.wait([
        host.refreshConfig(),
        host.loadVireonAccount(),
        host.loadOrchestration(),
        host.loadIntegrations(),
      ]);
    } finally {
      if (mounted && !silent) setState(() => _refreshing = false);
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

  Future<void> _confirmDeleteChat(AppController host, ChatSummary chat) async {
    final lim = LiminalTheme.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete chat?'),
        content: Text(
          '“${chat.title}” and its workspace will be removed. This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: lim.danger.withValues(alpha: 0.14),
              foregroundColor: lim.danger,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    await host.deleteChat(chat.chatId);
  }

  List<ChatSummary> _workspaceChats(List<ChatSummary> chats) {
    return chats.where((c) => !c.isOrchestrator).toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  }

  List<ChatSummary> _filteredChats(List<ChatSummary> chats) {
    final q = _chatSearch.text.trim().toLowerCase();
    if (q.isEmpty) return chats;
    return chats
        .where(
          (c) =>
              c.title.toLowerCase().contains(q) ||
              c.workspaceRoot.toLowerCase().contains(q),
        )
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final host = AppScope.watch(context);
    _syncOrchestrationPoll(host);
    final lim = LiminalTheme.of(context);
    final workspaceChats = _workspaceChats(host.chats);
    final filtered = _filteredChats(workspaceChats);
    final visibleLimit = _showAllChats ? filtered.length : 8;
    final visibleChats = filtered.take(visibleLimit).toList();
    final busyCount = workspaceChats.where((c) => c.busy).length;
    final greeting = _greeting(host);

    return LiminalShell(
      appBar: AppBar(
        title: const VireonBrandMark(compact: true, tagline: 'Desktop'),
        actions: [
          if (_refreshing)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 12),
              child: Center(
                child: SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            )
          else
            LiminalIconButton(
              icon: Icons.refresh,
              tooltip: 'Refresh hub',
              onPressed: () => _refreshHub(host),
            ),
          LiminalIconButton(
            icon: Icons.extension_outlined,
            tooltip: 'Integrations',
            onPressed: () => context.push(AppRoutes.integrations),
          ),
          LiminalIconButton(
            icon: Icons.settings_outlined,
            tooltip: 'Settings',
            onPressed: () => context.push(AppRoutes.settings),
          ),
        ],
      ),
      body: LiminalPageCanvas(
        child: RefreshIndicator(
          onRefresh: () => _refreshHub(host),
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: LiminalBreakpoints.pagePadding(context),
            child: LayoutBuilder(
              builder: (context, constraints) {
                final wide = constraints.maxWidth >= LiminalBreakpoints.medium;
                final header = _HubHeader(
                  greeting: greeting,
                  subtitle: _hubSubtitle(host),
                  account: host.vireonAccount,
                );
                final status = _HubStatusStrip(host: host);
                final quickActions = _HubQuickActions(
                  opening: _openingChat,
                  onNewChat: () => _newChat(host),
                  onMission: () => _openOrchestrator(host),
                  onIntegrations: () => context.push(AppRoutes.integrations),
                  onSettings: () => context.push(AppRoutes.settings),
                );
                final stats = _HubStatsRow(
                  chatCount: workspaceChats.length,
                  busyCount: busyCount,
                  integrationsConnected: _connectedProviderCount(host.integrations),
                  orchestration: host.orchestration,
                );
                final mission = _HubMissionSection(
                  host: host,
                  opening: _openingChat,
                  onOpenChat: () => _openOrchestrator(host),
                  onViewWorkers: () => _viewOrchestrationChats(host),
                );
                final chats = _HubChatsSection(
                  searchController: _chatSearch,
                  onSearchChanged: (_) => setState(() {}),
                  visibleChats: visibleChats,
                  totalFiltered: filtered.length,
                  totalChats: workspaceChats.length,
                  showAll: _showAllChats,
                  onToggleShowAll: () => setState(() => _showAllChats = !_showAllChats),
                  opening: _openingChat,
                  onNewChat: () => _newChat(host),
                  onOpenChat: (id) => _openChat(host, id),
                  onDeleteChat: (chat) => _confirmDeleteChat(host, chat),
                );
                final integrations = _HubIntegrationsSection(
                  host: host,
                  onManage: () => context.push(AppRoutes.integrations),
                );

                if (wide) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      header,
                      const SizedBox(height: LiminalSpacing.md),
                      status,
                      const SizedBox(height: LiminalSpacing.lg),
                      quickActions,
                      const SizedBox(height: LiminalSpacing.md),
                      stats,
                      const SizedBox(height: LiminalSpacing.lg),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(flex: 3, child: chats),
                          const SizedBox(width: LiminalSpacing.lg),
                          Expanded(
                            flex: 2,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                mission,
                                const SizedBox(height: LiminalSpacing.lg),
                                integrations,
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: LiminalSpacing.md),
                      Text(
                        'Sidecar ${host.sidecarVersion}',
                        textAlign: TextAlign.center,
                        style: LiminalTypography.caption(context).copyWith(color: lim.textDim),
                      ),
                    ],
                  );
                }

                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    header,
                    const SizedBox(height: LiminalSpacing.md),
                    status,
                    const SizedBox(height: LiminalSpacing.lg),
                    quickActions,
                    const SizedBox(height: LiminalSpacing.md),
                    stats,
                    const SizedBox(height: LiminalSpacing.lg),
                    mission,
                    const SizedBox(height: LiminalSpacing.lg),
                    chats,
                    const SizedBox(height: LiminalSpacing.lg),
                    integrations,
                    const SizedBox(height: LiminalSpacing.md),
                    Text(
                      'Sidecar ${host.sidecarVersion}',
                      textAlign: TextAlign.center,
                      style: LiminalTypography.caption(context).copyWith(color: lim.textDim),
                    ),
                  ],
                );
              },
            ),
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
    final persona = host.config?.personaDisplayLabel;
    if (persona != null && persona.isNotEmpty && persona != 'Liminal') {
      return 'Welcome back';
    }
    return 'Welcome to Vireon';
  }

  String _hubSubtitle(AppController host) {
    final persona = host.config?.personaDisplayLabel ?? 'Liminal';
    return 'Your $persona workspace — chats, missions, and connected tools.';
  }

  int _connectedProviderCount(IntegrationsSnapshot snap) {
    return [
      snap.googleConnected,
      snap.microsoftConnected,
      snap.githubConnected,
      snap.xeroConnected,
      snap.slackConnected,
      snap.linearConnected,
      snap.notionConnected,
    ].where((v) => v).length;
  }
}

class _HubHeader extends StatelessWidget {
  const _HubHeader({
    required this.greeting,
    required this.subtitle,
    required this.account,
  });

  final String greeting;
  final String subtitle;
  final VireonAccountSnapshot account;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(greeting, style: LiminalTypography.pageTitle(context)),
        const SizedBox(height: 6),
        Text(subtitle, style: LiminalTypography.body(context)),
        if (account.connected && account.email != null) ...[
          const SizedBox(height: LiminalSpacing.sm),
          _AccountChip(snapshot: account),
        ],
      ],
    );
  }
}

class _HubStatusStrip extends StatelessWidget {
  const _HubStatusStrip({required this.host});

  final AppController host;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final online = host.phase == ConnectionPhase.connected && host.sidecarReady;
    final persona = host.config?.personaDisplayLabel ?? 'Liminal';

    return LiminalCard(
      padding: const EdgeInsets.symmetric(
        horizontal: LiminalSpacing.md,
        vertical: LiminalSpacing.sm,
      ),
      child: Row(
        children: [
          _StatusDot(online: online, label: online ? 'Sidecar ready' : 'Connecting…'),
          _StripDivider(color: lim.border),
          Icon(Icons.psychology_outlined, size: 16, color: lim.textMuted),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              persona,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: lim.text),
            ),
          ),
          if (host.integrationsLoading)
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2, color: lim.accent),
            )
          else
            LiminalBadge(
              label: '${_connectedCount(host.integrations)} tools',
              tone: _connectedCount(host.integrations) > 0
                  ? LiminalBadgeTone.accent
                  : LiminalBadgeTone.neutral,
              icon: Icons.link,
            ),
        ],
      ),
    );
  }

  int _connectedCount(IntegrationsSnapshot snap) {
    return [
      snap.googleConnected,
      snap.microsoftConnected,
      snap.githubConnected,
      snap.xeroConnected,
      snap.slackConnected,
      snap.linearConnected,
      snap.notionConnected,
    ].where((v) => v).length;
  }
}

class _StatusDot extends StatelessWidget {
  const _StatusDot({required this.online, required this.label});

  final bool online;
  final String label;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: online ? lim.accent : lim.textDim,
            boxShadow: online
                ? [BoxShadow(color: lim.accent.withValues(alpha: 0.45), blurRadius: 6)]
                : null,
          ),
        ),
        const SizedBox(width: 8),
        Text(
          label,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: online ? lim.text : lim.textMuted,
                fontWeight: FontWeight.w500,
              ),
        ),
      ],
    );
  }
}

class _StripDivider extends StatelessWidget {
  const _StripDivider({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 1,
      height: 20,
      margin: const EdgeInsets.symmetric(horizontal: LiminalSpacing.sm),
      color: color,
    );
  }
}

class _HubQuickActions extends StatelessWidget {
  const _HubQuickActions({
    required this.opening,
    required this.onNewChat,
    required this.onMission,
    required this.onIntegrations,
    required this.onSettings,
  });

  final bool opening;
  final VoidCallback onNewChat;
  final VoidCallback onMission;
  final VoidCallback onIntegrations;
  final VoidCallback onSettings;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final cols = constraints.maxWidth >= LiminalBreakpoints.compact ? 4 : 2;
        final actions = [
          _QuickActionTile(
            icon: Icons.add_comment_outlined,
            label: 'New chat',
            hint: 'Start a harness session',
            onTap: opening ? null : onNewChat,
          ),
          _QuickActionTile(
            icon: Icons.hub_outlined,
            label: 'Mission control',
            hint: 'Orchestrator chat',
            onTap: opening ? null : onMission,
          ),
          _QuickActionTile(
            icon: Icons.extension_outlined,
            label: 'Integrations',
            hint: 'Connect tools & APIs',
            onTap: onIntegrations,
          ),
          _QuickActionTile(
            icon: Icons.tune_outlined,
            label: 'Settings',
            hint: 'Harness & persona',
            onTap: onSettings,
          ),
        ];

        return Wrap(
          spacing: LiminalSpacing.sm,
          runSpacing: LiminalSpacing.sm,
          children: [
            for (var i = 0; i < actions.length; i++)
              SizedBox(
                width: cols == 4
                    ? (constraints.maxWidth - LiminalSpacing.sm * 3) / 4
                    : (constraints.maxWidth - LiminalSpacing.sm) / 2,
                child: actions[i],
              ),
          ],
        );
      },
    );
  }
}

class _QuickActionTile extends StatelessWidget {
  const _QuickActionTile({
    required this.icon,
    required this.label,
    required this.hint,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final String hint;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return LiminalCard(
      onTap: onTap,
      padding: const EdgeInsets.all(LiminalSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 22, color: lim.accent),
          const SizedBox(height: LiminalSpacing.xs),
          Text(
            label,
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  color: lim.text,
                  fontWeight: FontWeight.w600,
                ),
          ),
          const SizedBox(height: 2),
          Text(
            hint,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: LiminalTypography.caption(context),
          ),
        ],
      ),
    );
  }
}

class _HubStatsRow extends StatelessWidget {
  const _HubStatsRow({
    required this.chatCount,
    required this.busyCount,
    required this.integrationsConnected,
    required this.orchestration,
  });

  final int chatCount;
  final int busyCount;
  final int integrationsConnected;
  final OrchestrationSnapshot orchestration;

  @override
  Widget build(BuildContext context) {
    final missionLabel = orchestration.isActive
        ? 'Running'
        : orchestration.status == 'completed'
            ? 'Done'
            : orchestration.status == 'failed'
                ? 'Failed'
                : 'Idle';

    return LayoutBuilder(
      builder: (context, constraints) {
        final cols = constraints.maxWidth >= LiminalBreakpoints.compact ? 4 : 2;
        final gap = LiminalSpacing.sm;
        final w = (constraints.maxWidth - gap * (cols - 1)) / cols;
        final stats = [
          _StatTile(value: '$chatCount', label: 'Chats'),
          _StatTile(
            value: busyCount > 0 ? '$busyCount' : '—',
            label: 'Active now',
            highlight: busyCount > 0,
          ),
          _StatTile(
            value: '$integrationsConnected',
            label: 'Integrations',
            highlight: integrationsConnected > 0,
          ),
          _StatTile(
            value: missionLabel,
            label: 'Mission',
            highlight: orchestration.isActive,
          ),
        ];

        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [for (final s in stats) SizedBox(width: w, child: s)],
        );
      },
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.value,
    required this.label,
    this.highlight = false,
  });

  final String value;
  final String label;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return LiminalCard(
      padding: const EdgeInsets.symmetric(
        horizontal: LiminalSpacing.md,
        vertical: LiminalSpacing.sm,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  color: highlight ? lim.accent : lim.text,
                  fontWeight: FontWeight.w700,
                ),
          ),
          Text(label, style: LiminalTypography.caption(context)),
        ],
      ),
    );
  }
}

class _HubMissionSection extends StatefulWidget {
  const _HubMissionSection({
    required this.host,
    required this.opening,
    required this.onOpenChat,
    required this.onViewWorkers,
  });

  final AppController host;
  final bool opening;
  final VoidCallback onOpenChat;
  final VoidCallback onViewWorkers;

  @override
  State<_HubMissionSection> createState() => _HubMissionSectionState();
}

class _HubMissionSectionState extends State<_HubMissionSection> {
  final _goal = TextEditingController();
  bool _canStart = false;

  @override
  void initState() {
    super.initState();
    _goal.addListener(_onGoalChanged);
  }

  @override
  void dispose() {
    _goal.removeListener(_onGoalChanged);
    _goal.dispose();
    super.dispose();
  }

  void _onGoalChanged() {
    final next = _goal.text.trim().isNotEmpty;
    if (next != _canStart && mounted) setState(() => _canStart = next);
  }

  Future<void> _startMission() async {
    final goal = _goal.text.trim();
    if (goal.isEmpty) return;
    final ok = await widget.host.startOrchestration(goal);
    if (!mounted) return;
    if (ok) {
      _goal.clear();
      widget.onOpenChat();
    }
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final snap = widget.host.orchestration;
    final running = snap.isActive;
    final workersDone = snap.workers.where((w) => w.isDone).length;
    final workersTotal = snap.workers.length;
    final showMissionState = running ||
        snap.status == 'completed' ||
        snap.status == 'failed' ||
        snap.status == 'stopped';

    return LiminalSection(
      title: 'Mission Control',
      subtitle: 'Plan multi-step work, spawn worker chats, and synthesize results.',
      trailing: LiminalButton.icon(
        label: 'Open chat',
        icon: Icons.hub_outlined,
        variant: LiminalButtonVariant.secondary,
        dense: true,
        onPressed: widget.opening ? null : widget.onOpenChat,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (showMissionState) ...[
            OrchestratorMissionBanner(snapshot: snap),
            if (snap.goal.isNotEmpty) ...[
              const SizedBox(height: LiminalSpacing.sm),
              Text(
                snap.goal,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: lim.textMuted,
                      height: 1.4,
                    ),
              ),
            ],
            if (workersTotal > 0) ...[
              const SizedBox(height: LiminalSpacing.xs),
              Text(
                '$workersDone of $workersTotal workers complete',
                style: LiminalTypography.caption(context),
              ),
            ],
            const SizedBox(height: LiminalSpacing.sm),
            Wrap(
              spacing: LiminalSpacing.xs,
              runSpacing: LiminalSpacing.xs,
              children: [
                if (running)
                  LiminalButton.icon(
                    label: 'Stop mission',
                    icon: Icons.stop_circle_outlined,
                    variant: LiminalButtonVariant.danger,
                    dense: true,
                    onPressed: widget.host.orchestrationBusy
                        ? null
                        : () => widget.host.stopOrchestration(),
                  ),
                if (snap.workerChatIds.isNotEmpty)
                  LiminalButton.icon(
                    label: 'View worker chats',
                    icon: Icons.open_in_new,
                    variant: LiminalButtonVariant.secondary,
                    dense: true,
                    onPressed: widget.opening ? null : widget.onViewWorkers,
                  ),
              ],
            ),
          ] else ...[
            TextField(
              controller: _goal,
              enabled: !widget.host.orchestrationBusy,
              minLines: 2,
              maxLines: 4,
              decoration: InputDecoration(
                hintText:
                    'Describe a mission — e.g. research hosting options and write a decision memo…',
                filled: true,
                fillColor: lim.surface.withValues(alpha: 0.45),
              ),
            ),
            const SizedBox(height: LiminalSpacing.sm),
            Align(
              alignment: Alignment.centerLeft,
              child: LiminalButton.icon(
                label: 'Start mission',
                icon: Icons.rocket_launch_outlined,
                onPressed: (!_canStart || widget.host.orchestrationBusy)
                    ? null
                    : _startMission,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _HubChatsSection extends StatelessWidget {
  const _HubChatsSection({
    required this.searchController,
    required this.onSearchChanged,
    required this.visibleChats,
    required this.totalFiltered,
    required this.totalChats,
    required this.showAll,
    required this.onToggleShowAll,
    required this.opening,
    required this.onNewChat,
    required this.onOpenChat,
    required this.onDeleteChat,
  });

  final TextEditingController searchController;
  final ValueChanged<String> onSearchChanged;
  final List<ChatSummary> visibleChats;
  final int totalFiltered;
  final int totalChats;
  final bool showAll;
  final VoidCallback onToggleShowAll;
  final bool opening;
  final VoidCallback onNewChat;
  final void Function(String chatId) onOpenChat;
  final void Function(ChatSummary chat) onDeleteChat;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final hasMore = !showAll && totalFiltered > visibleChats.length;

    return LiminalSection(
      title: 'Recent chats',
      subtitle: '$totalChats workspace${totalChats == 1 ? '' : 's'} · harness sessions & tools',
      trailing: LiminalButton.icon(
        label: 'New chat',
        icon: Icons.add,
        dense: true,
        onPressed: opening ? null : onNewChat,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (totalChats > 3) ...[
            LiminalSearchField(
              controller: searchController,
              hintText: 'Search chats…',
              onChanged: onSearchChanged,
            ),
            const SizedBox(height: LiminalSpacing.sm),
          ],
          if (visibleChats.isEmpty)
            LiminalEmptyState(
              title: searchController.text.trim().isEmpty ? 'No chats yet' : 'No matches',
              body: searchController.text.trim().isEmpty
                  ? 'Start a session when you are ready to work with your agent.'
                  : 'Try a different title or workspace path.',
              icon: Icons.chat_bubble_outline,
              actionLabel: searchController.text.trim().isEmpty ? 'Start first chat' : null,
              onAction: searchController.text.trim().isEmpty ? onNewChat : null,
              compact: true,
            )
          else
            Column(
              children: [
                for (final chat in visibleChats)
                  _HubChatRow(
                    chat: chat,
                    busy: opening,
                    onTap: () => onOpenChat(chat.chatId),
                    onDelete: () => onDeleteChat(chat),
                  ),
              ],
            ),
          if (hasMore)
            Padding(
              padding: const EdgeInsets.only(top: LiminalSpacing.xs),
              child: Align(
                alignment: Alignment.centerLeft,
                child: LiminalButton(
                  label: 'Show all $totalFiltered chats',
                  variant: LiminalButtonVariant.ghost,
                  dense: true,
                  onPressed: onToggleShowAll,
                ),
              ),
            )
          else if (showAll && totalFiltered > 8)
            Padding(
              padding: const EdgeInsets.only(top: LiminalSpacing.xs),
              child: Align(
                alignment: Alignment.centerLeft,
                child: LiminalButton(
                  label: 'Show fewer',
                  variant: LiminalButtonVariant.ghost,
                  dense: true,
                  onPressed: onToggleShowAll,
                ),
              ),
            ),
          if (totalChats > 0 && searchController.text.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: LiminalSpacing.xs),
              child: Text(
                'Orchestrator chat is available under Mission Control.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: lim.textDim),
              ),
            ),
        ],
      ),
    );
  }
}

class _HubChatRow extends StatelessWidget {
  const _HubChatRow({
    required this.chat,
    required this.onTap,
    required this.onDelete,
    required this.busy,
  });

  final ChatSummary chat;
  final VoidCallback onTap;
  final VoidCallback onDelete;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final time = hubRelativeTime(chat.updatedAt);
    final subtitle = chat.busy
        ? 'Running…'
        : chat.workspaceRoot.isNotEmpty
            ? chat.workspaceRoot
            : 'Workspace';

    return LiminalListRow(
      title: chat.title,
      subtitle: subtitle,
      monoSubtitle: !chat.busy,
      enabled: !busy,
      onTap: onTap,
      leading: Icon(
        chat.busy ? Icons.bolt : Icons.chat_bubble_outline,
        size: 18,
        color: chat.busy ? lim.accent : lim.textDim,
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (chat.busy)
            const Padding(
              padding: EdgeInsets.only(right: 6),
              child: LiminalBadge(label: 'Busy', tone: LiminalBadgeTone.accent),
            ),
          if (time.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: Text(time, style: LiminalTypography.caption(context)),
            ),
          PopupMenuButton<String>(
            tooltip: 'Chat actions',
            icon: Icon(Icons.more_vert, size: 18, color: lim.textMuted),
            onSelected: (value) {
              if (value == 'open') onTap();
              if (value == 'delete') onDelete();
            },
            itemBuilder: (ctx) => [
              const PopupMenuItem(value: 'open', child: Text('Open')),
              PopupMenuItem(
                value: 'delete',
                child: Text('Delete', style: TextStyle(color: lim.danger)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _HubIntegrationsSection extends StatelessWidget {
  const _HubIntegrationsSection({
    required this.host,
    required this.onManage,
  });

  final AppController host;
  final VoidCallback onManage;

  @override
  Widget build(BuildContext context) {
    final snap = host.integrations;
    final providers = _providerStates(snap);

    return LiminalSection(
      title: 'Integrations',
      subtitle: 'Connect email, calendar, code, and accounting for your agent.',
      trailing: LiminalButton.icon(
        label: 'Manage',
        icon: Icons.extension_outlined,
        variant: LiminalButtonVariant.secondary,
        dense: true,
        onPressed: onManage,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (host.integrationsLoading && snap.connections.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: LiminalSpacing.sm),
              child: LinearProgressIndicator(),
            )
          else ...[
            Wrap(
              spacing: LiminalSpacing.xs,
              runSpacing: LiminalSpacing.xs,
              children: [
                for (final p in providers)
                  _IntegrationChip(
                    id: p.id,
                    connected: p.connected,
                    onTap: onManage,
                  ),
              ],
            ),
            if (host.integrationsError != null) ...[
              const SizedBox(height: LiminalSpacing.sm),
              Text(
                host.integrationsError!,
                style: TextStyle(
                  color: LiminalTheme.of(context).danger,
                  fontSize: 13,
                ),
              ),
            ] else if (snap.connections.isNotEmpty) ...[
              const SizedBox(height: LiminalSpacing.sm),
              Text(
                '${snap.connections.length} active connection${snap.connections.length == 1 ? '' : 's'}',
                style: LiminalTypography.caption(context),
              ),
            ],
          ],
        ],
      ),
    );
  }

  List<({IntegrationBrandId id, bool connected})> _providerStates(
    IntegrationsSnapshot snap,
  ) {
    return [
      (id: IntegrationBrandId.google, connected: snap.googleConnected),
      (id: IntegrationBrandId.microsoft, connected: snap.microsoftConnected),
      (id: IntegrationBrandId.github, connected: snap.githubConnected),
      (id: IntegrationBrandId.xero, connected: snap.xeroConnected),
      (id: IntegrationBrandId.slack, connected: snap.slackConnected),
      (id: IntegrationBrandId.linear, connected: snap.linearConnected),
      (id: IntegrationBrandId.notion, connected: snap.notionConnected),
    ];
  }
}

class _IntegrationChip extends StatelessWidget {
  const _IntegrationChip({
    required this.id,
    required this.connected,
    required this.onTap,
  });

  final IntegrationBrandId id;
  final bool connected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final meta = integrationBrands[id]!;
    final lim = LiminalTheme.of(context);
    return LiminalInteractive(
      onPressed: onTap,
      borderRadius: BorderRadius.circular(lim.radius),
      builder: (context, hovered, focused) {
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: connected
                ? meta.accentSoft
                : lim.panel.withValues(alpha: hovered ? 0.7 : 0.45),
            borderRadius: BorderRadius.circular(lim.radius),
            border: Border.all(
              color: connected
                  ? meta.accent.withValues(alpha: 0.45)
                  : lim.border.withValues(alpha: hovered ? 0.9 : 0.6),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IntegrationBrandIcon(id: id, size: 22),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    meta.title,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: lim.text,
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                  Text(
                    connected ? 'Connected' : 'Not connected',
                    style: TextStyle(
                      fontSize: 11,
                      color: connected ? meta.accent : lim.textDim,
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }
}

class _AccountChip extends StatelessWidget {
  const _AccountChip({required this.snapshot});

  final VireonAccountSnapshot snapshot;

  @override
  Widget build(BuildContext context) {
    final tier = snapshot.tier;
    return Align(
      alignment: Alignment.centerLeft,
      child: LiminalBadge(
        label: '${snapshot.email} · $tier',
        tone: LiminalBadgeTone.accent,
        icon: Icons.verified_user_outlined,
      ),
    );
  }
}

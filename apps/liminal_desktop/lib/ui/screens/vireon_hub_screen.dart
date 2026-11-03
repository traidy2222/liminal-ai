import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_scope.dart';
import '../../models/persona_ui_theme.dart';
import '../theme/liminal_theme.dart';
import 'hub/workspace_hub.dart';
import '../../protocol/chat_summary.dart';
import '../../routing/routes.dart';
import '../../state/app_controller.dart';
import '../design_system/liminal_design_system.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import '../widgets/inbox_panel.dart';
import '../widgets/orchestrator_panel.dart';
import '../widgets/update_banner.dart';
import '../widgets/usage_analytics_panel.dart';

class VireonHubScreen extends StatefulWidget {
  const VireonHubScreen({super.key});

  @override
  State<VireonHubScreen> createState() => _VireonHubScreenState();
}

class _VireonHubScreenState extends State<VireonHubScreen> {
  bool _openingChat = false;
  bool _refreshing = false;
  Timer? _orchestrationPoll;

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
        host.refreshConfig(background: true),
        host.loadVireonAccount(),
        host.loadOrchestration(),
        host.loadIntegrations(),
        host.loadInboxStatus(),
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

  Future<void> _openInboxPanel(AppController host) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => InboxPanel(
        snapshot: host.inbox,
        busy: host.inboxBusy,
        onRefresh: host.loadInboxStatus,
        onDismiss: host.dismissInboxItems,
        onProcess: host.processInboxItems,
      ),
    );
  }

  void _maybeShowInboxToast(AppController host) {
    final msg = host.inboxToastMessage;
    if (msg == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      host.clearInboxToast();
    });
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

  @override
  Widget build(BuildContext context) {
    final host = AppScope.watch(context);
    _syncOrchestrationPoll(host);
    _maybeShowInboxToast(host);
    final current = LiminalTheme.of(context);
    // Persona identity stays in the accent and name. Navigation and work
    // surfaces use stable contrast instead of the persona's ambient background.
    const defaults = PersonaUiTheme.liminalDefault;
    final hubTheme = buildLiminalTheme(
        persona: PersonaUiTheme(
      accent: current.accent,
      secondary: defaults.secondary,
      warn: defaults.warn,
      danger: defaults.danger,
      success: defaults.success,
      muted: defaults.muted,
      surfaceTint: defaults.surfaceTint,
      displayLabel: current.displayLabel,
      glowIntensity: 0,
    ),);
    return Theme(
      data: hubTheme,
      child: WorkspaceHub(
        chats: host.chats,
        integrations: host.integrations,
        integrationsError: host.integrationsError,
        personaName: host.config?.personaDisplayLabel ?? 'Liminal',
        accountLabel: host.vireonAccount.email ?? '',
        online: host.phase == ConnectionPhase.connected && host.sidecarReady,
        opening: _openingChat,
        refreshing: _refreshing,
        inboxCount: host.inbox.pendingCount,
        inboxNeedsAction: host.inbox.needsActionCount,
        missionActive: host.orchestration.isActive,
        banner: Column(children: [
          const UpdateBanner(),
          UsageAnalyticsPanel(analytics: host.usage, compact: true, onChoice: host.setUsageConsent),
        ],),
        mission: _HubMissionSection(
          host: host,
          opening: _openingChat,
          onOpenChat: () => _openOrchestrator(host),
          onViewWorkers: () => _viewOrchestrationChats(host),
        ),
        onNewChat: () => _newChat(host),
        onOpenChat: (id) => _openChat(host, id),
        onDeleteChat: (chat) => _confirmDeleteChat(host, chat),
        onInbox: () => _openInboxPanel(host),
        onIntegrations: () => context.push(AppRoutes.integrations),
        onSettings: () => context.push(AppRoutes.settings),
        onRefresh: () => _refreshHub(host),
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

    return Container(
      padding: const EdgeInsets.all(28),
      decoration: BoxDecoration(
        color: lim.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: lim.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 16,
            runSpacing: 12,
            children: [
              const Text('Mission control',
                  style: TextStyle(
                      fontFamily: 'Space Grotesk',
                      fontSize: 26,
                      letterSpacing: -0.6,),),
              OutlinedButton.icon(
                label: const Text('Open mission chat'),
                icon: const Icon(Icons.arrow_outward, size: 16),
                onPressed: widget.opening ? null : widget.onOpenChat,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
              'Describe the outcome you want. Your agent will plan and coordinate the work.',
              style: TextStyle(color: lim.textMuted, height: 1.5),),
          const SizedBox(height: 28),
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
              minLines: 5,
              maxLines: 10,
              decoration: InputDecoration(
                hintText:
                    'What should this mission accomplish?\n\nFor example: review this project, identify the most important improvements, and write an implementation plan.',
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
          if (snap.error != null && snap.error!.isNotEmpty) ...[
            const SizedBox(height: 16),
            Text(snap.error!, style: TextStyle(color: lim.danger)),
          ],
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';

import '../../../models/integrations_snapshot.dart';
import '../../../protocol/chat_summary.dart';
import '../../design_system/liminal_design_system.dart';
import '../../theme/liminal_theme_extension.dart';
import '../../widgets/integration_brand_icon.dart';
import '../../widgets/liminal_brand.dart';
import 'hub_format.dart';

/// The workspace home is deliberately independent of the transport/controller.
/// Every action is supplied by the host; browsing never starts an agent run.
class WorkspaceHub extends StatefulWidget {
  const WorkspaceHub({
    super.key,
    required this.chats,
    required this.integrations,
    required this.personaName,
    required this.accountLabel,
    required this.online,
    required this.opening,
    required this.refreshing,
    required this.inboxCount,
    required this.inboxNeedsAction,
    required this.missionActive,
    required this.mission,
    required this.onNewChat,
    required this.onOpenChat,
    required this.onDeleteChat,
    required this.onInbox,
    required this.onIntegrations,
    required this.onSettings,
    required this.onRefresh,
    this.integrationsError,
    this.banner = const SizedBox.shrink(),
  });

  final List<ChatSummary> chats;
  final IntegrationsSnapshot integrations;
  final String personaName;
  final String accountLabel;
  final bool online;
  final bool opening;
  final bool refreshing;
  final int inboxCount;
  final int inboxNeedsAction;
  final bool missionActive;
  final Widget mission;
  final Widget banner;
  final String? integrationsError;
  final VoidCallback onNewChat;
  final ValueChanged<String> onOpenChat;
  final ValueChanged<ChatSummary> onDeleteChat;
  final VoidCallback onInbox;
  final VoidCallback onIntegrations;
  final VoidCallback onSettings;
  final Future<void> Function() onRefresh;

  @override
  State<WorkspaceHub> createState() => _WorkspaceHubState();
}

enum _HubPage { overview, conversations, missions, connections }

class _WorkspaceHubState extends State<WorkspaceHub> {
  _HubPage _page = _HubPage.overview;
  final _search = TextEditingController();
  final _scroll = ScrollController();
  int _visible = 12;
  bool _activeOnly = false;

  @override
  void dispose() {
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _select(_HubPage page) {
    setState(() => _page = page);
    if (_scroll.hasClients) _scroll.jumpTo(0);
  }

  List<ChatSummary> get _chats =>
      widget.chats.where((c) => !c.isOrchestrator).toList()
        ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));

  List<({IntegrationBrandId id, bool connected})> get _providers => [
        (
          id: IntegrationBrandId.google,
          connected: widget.integrations.googleConnected
        ),
        (
          id: IntegrationBrandId.microsoft,
          connected: widget.integrations.microsoftConnected
        ),
        (
          id: IntegrationBrandId.github,
          connected: widget.integrations.githubConnected
        ),
        (
          id: IntegrationBrandId.xero,
          connected: widget.integrations.xeroConnected
        ),
        (
          id: IntegrationBrandId.slack,
          connected: widget.integrations.slackConnected
        ),
        (
          id: IntegrationBrandId.linear,
          connected: widget.integrations.linearConnected
        ),
        (
          id: IntegrationBrandId.notion,
          connected: widget.integrations.notionConnected
        ),
        (
          id: IntegrationBrandId.youtube,
          connected: widget.integrations.youtubeConnected
        ),
      ];

  String get _title => switch (_page) {
        _HubPage.overview => 'Overview',
        _HubPage.conversations => 'Conversations',
        _HubPage.missions => 'Mission control',
        _HubPage.connections => 'Connected tools',
      };

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return LayoutBuilder(builder: (context, bounds) {
      final wide = bounds.maxWidth >= 1050;
      return Scaffold(
        backgroundColor: lim.background,
        drawer:
            wide ? null : Drawer(width: 244, child: _navigation(drawer: true)),
        body: SafeArea(
          child: Row(children: [
            if (wide) SizedBox(width: 232, child: _navigation()),
            Expanded(
                child: Column(children: [
              _toolbar(wide),
              Expanded(
                  child: RefreshIndicator(
                onRefresh: widget.onRefresh,
                child: SingleChildScrollView(
                  controller: _scroll,
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: EdgeInsets.all(bounds.maxWidth < 650 ? 20 : 36),
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 1400),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            widget.banner,
                            if (_page == _HubPage.overview) _overview(),
                            if (_page == _HubPage.conversations)
                              _conversations(),
                            Offstage(
                              key: const ValueKey('hub-mission-editor'),
                              offstage: _page != _HubPage.missions,
                              child: TickerMode(
                                enabled: _page == _HubPage.missions,
                                child: ExcludeFocus(
                                  excluding: _page != _HubPage.missions,
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                              _heading('Give the bigger work a plan.',
                                  'Set a goal, follow the work, and review the result.',),
                              const SizedBox(height: 28),
                              widget.mission,
                            ],),),),),
                            if (_page == _HubPage.connections) ...[
                              _heading('Bring your tools together.',
                                  'Manage the services your agent can work with.',),
                              const SizedBox(height: 28),
                              _connections(all: true),
                            ],
                            const SizedBox(height: 32),
                            Text('LIMINAL  /  YOUR WORKING SPACE',
                                style: TextStyle(
                                  fontFamily: 'JetBrains Mono',
                                  fontSize: 10,
                                  letterSpacing: 1.5,
                                  color: lim.textDim,
                                ),),
                          ],),
                    ),
                  ),
                ),
              ),),
            ],),),
          ],),
        ),
      );
    },);
  }

  Widget _navigation({bool drawer = false}) {
    final lim = LiminalTheme.of(context);
    void select(_HubPage page) {
      if (drawer) Navigator.of(context).pop();
      _select(page);
    }

    return Material(
      color: lim.surface,
      child: Container(
        decoration:
            BoxDecoration(border: Border(right: BorderSide(color: lim.border))),
        padding: const EdgeInsets.fromLTRB(18, 28, 18, 20),
        child: CustomScrollView(slivers: [SliverFillRemaining(
          hasScrollBody: false,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Padding(
              padding: EdgeInsets.symmetric(horizontal: 8),
              child: LiminalBrandMark(
                  compact: true, subtitle: 'Your working space',),),
          const SizedBox(height: 36),
          FilledButton.icon(
            onPressed: widget.opening ? null : widget.onNewChat,
            icon: const Icon(Icons.add, size: 18),
            label: const Text('New conversation'),
            style:
                FilledButton.styleFrom(minimumSize: const Size.fromHeight(46)),
          ),
          const SizedBox(height: 32),
          _eyebrow('WORKSPACE'),
          const SizedBox(height: 12),
          for (final item in [
            (_HubPage.overview, Icons.space_dashboard_outlined, 'Overview'),
            (
              _HubPage.conversations,
              Icons.chat_bubble_outline,
              'Conversations'
            ),
            (_HubPage.missions, Icons.account_tree_outlined, 'Mission control'),
            (_HubPage.connections, Icons.grid_view_outlined, 'Connected tools'),
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: _NavItem(
                  icon: item.$2,
                  label: item.$3,
                  selected: _page == item.$1,
                  count: item.$1 == _HubPage.conversations
                      ? '${_chats.length}'
                      : null,
                  onTap: () => select(item.$1),),
            ),
          const Spacer(),
          _NavItem(
              icon: Icons.inbox_outlined,
              label: 'Inbox',
              count: widget.inboxCount > 0 ? '${widget.inboxCount}' : null,
              onTap: widget.onInbox,),
          const SizedBox(height: 6),
          _NavItem(
              icon: Icons.settings_outlined,
              label: 'Settings',
              onTap: widget.onSettings,),
          const SizedBox(height: 22),
          Divider(color: lim.border),
          const SizedBox(height: 16),
          Row(children: [
            Container(
                width: 34,
                height: 34,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                    color: lim.panel, borderRadius: BorderRadius.circular(10),),
                child:
                    Icon(Icons.person_outline, size: 18, color: lim.textMuted),),
            const SizedBox(width: 10),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text(
                      widget.accountLabel.isEmpty
                          ? 'Local workspace'
                          : widget.accountLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12, color: lim.text),),
                  const SizedBox(height: 4),
                  Text('Personal workspace',
                      style: TextStyle(fontSize: 11, color: lim.textDim),),
                ],),),
          ],),
        ],),),],),
      ),
    );
  }

  Widget _toolbar(bool wide) {
    final lim = LiminalTheme.of(context);
    return Container(
      height: 72,
      padding: EdgeInsets.symmetric(horizontal: wide ? 36 : 16),
      decoration:
          BoxDecoration(border: Border(bottom: BorderSide(color: lim.border))),
      child: Row(children: [
        if (!wide)
          Builder(
              builder: (context) => IconButton(
                  tooltip: 'Open workspace navigation',
                  onPressed: () => Scaffold.of(context).openDrawer(),
                  icon: const Icon(Icons.menu, size: 20),),),
        if (wide) ...[
          Text('Workspace', style: TextStyle(fontSize: 12, color: lim.textDim)),
          Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: Text('/', style: TextStyle(color: lim.textDim)),),
        ],
        Expanded(
            child: Text(_title,
                style: const TextStyle(
                    fontSize: 13, fontWeight: FontWeight.w600,),),),
        Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: widget.online ? lim.success : lim.warn,),),
        const SizedBox(width: 8),
        Text(widget.online ? 'Ready' : 'Connecting',
            style: TextStyle(fontSize: 11, color: lim.textMuted),),
        const SizedBox(width: 14),
        if (widget.refreshing)
          const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),)
        else
          IconButton(
              tooltip: 'Refresh hub',
              onPressed: widget.onRefresh,
              icon: const Icon(Icons.refresh, size: 18),),
      ],),
    );
  }

  Widget _overview() {
    final lim = LiminalTheme.of(context);
    final chats = _chats;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _heading('Room for your next idea.',
          'Build, explore, and get things done with ${widget.personaName}.',),
      const SizedBox(height: 28),
      LayoutBuilder(builder: (context, bounds) {
        final start = _startCard();
        final briefing = _briefing();
        if (bounds.maxWidth < 800) {
          return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [start, const SizedBox(height: 16), briefing],);
        }
        return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(flex: 7, child: start),
          const SizedBox(width: 20),
          Expanded(flex: 4, child: briefing),
        ],);
      },),
      const SizedBox(height: 32),
      _sectionTitle('Pick up where you left off',
          action: 'View all ${chats.length}',
          onAction: () => _select(_HubPage.conversations),),
      const SizedBox(height: 16),
      if (chats.isEmpty)
        _empty('Your first conversation starts here.',
            'Ask a question, bring a project, or explore an idea.',)
      else
        _chatGrid(chats.take(6).toList()),
      const SizedBox(height: 32),
      _sectionTitle('Your connected tools',
          action: 'Manage connections', onAction: widget.onIntegrations,),
      const SizedBox(height: 4),
      Text('One workspace, with the services you already use.',
          style: TextStyle(color: lim.textDim, fontSize: 12),),
      const SizedBox(height: 16),
      _connections(),
    ],);
  }

  Widget _startCard() {
    final lim = LiminalTheme.of(context);
    final paper = Color.lerp(lim.accent, const Color(0xFFF0EDF5), .80)!;
    const ink = Color(0xFF242432);
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration:
          BoxDecoration(color: paper, borderRadius: BorderRadius.circular(20)),
      child: Stack(children: [
        Positioned(
            right: -18,
            top: 4,
            bottom: -36,
            width: 240,
            child: IgnorePointer(
                child: CustomPaint(
                    painter:
                        _ThresholdArchitecture(ink.withValues(alpha: .12)),),),),
        Padding(
            padding: const EdgeInsets.all(28),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('A FRESH START',
                  style: TextStyle(
                      color: ink,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 2,),),
              const SizedBox(height: 22),
              const Text('What would you\nlike to work on?',
                  style: TextStyle(
                      fontFamily: 'Space Grotesk',
                      fontSize: 34,
                      height: 1.12,
                      letterSpacing: -1.3,
                      fontWeight: FontWeight.w500,
                      color: ink,),),
              const SizedBox(height: 14),
              const Text('A question. A project. A possibility.',
                  style: TextStyle(color: Color(0xFF535362), fontSize: 12),),
              const SizedBox(height: 24),
              FilledButton.icon(
                  onPressed: widget.opening ? null : widget.onNewChat,
                  style: FilledButton.styleFrom(
                      backgroundColor: ink,
                      foregroundColor: paper,
                      minimumSize: const Size(190, 46),),
                  icon: const Icon(Icons.add, size: 18),
                  label: Text(
                      widget.opening ? 'Opening…' : 'Start a conversation',),),
            ],),),
      ],),
    );
  }

  Widget _briefing() {
    final lim = LiminalTheme.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _surface(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(Icons.account_tree_outlined, color: lim.accent, size: 22),
          const Spacer(),
          _pill(widget.missionActive ? 'In progress' : 'MULTI-STEP WORK',
              accent: widget.missionActive,),
        ],),
        const SizedBox(height: 18),
        Text('A bigger goal?\nGive it a mission.',
            style: TextStyle(
                fontFamily: 'Space Grotesk',
                fontSize: 24,
                height: 1.15,
                letterSpacing: -.6,
                color: lim.text,),),
        const SizedBox(height: 10),
        Text(
            'Plan the work, coordinate agents,\nand bring the results together.',
            style: TextStyle(fontSize: 12, height: 1.6, color: lim.textMuted),),
        const SizedBox(height: 14),
        TextButton.icon(
            onPressed: () => _select(_HubPage.missions),
            iconAlignment: IconAlignment.end,
            icon: const Icon(Icons.arrow_forward, size: 16),
            label: const Text('Open mission control'),
            style: TextButton.styleFrom(
                padding: EdgeInsets.zero, minimumSize: const Size(0, 32),),),
      ],),),
      const SizedBox(height: 12),
      LiminalInteractive(
          onPressed: widget.onInbox,
          builder: (context, hovered, focused) => Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                decoration: BoxDecoration(
                    color: hovered ? lim.panel : lim.surface,
                    borderRadius: BorderRadius.circular(14),
                    border:
                        Border.all(color: focused ? lim.accent : lim.border),),
                child: Row(children: [
                  Icon(Icons.inbox_outlined, size: 20, color: lim.textMuted),
                  const SizedBox(width: 12),
                  Expanded(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                        Text(
                            widget.inboxCount > 0
                                ? '${widget.inboxCount} new in your inbox'
                                : 'Your inbox is clear',
                            style: const TextStyle(
                                fontSize: 12, fontWeight: FontWeight.w600,),),
                        if (widget.inboxNeedsAction > 0)
                          Text('${widget.inboxNeedsAction} need your attention',
                              style: TextStyle(fontSize: 11, color: lim.warn),),
                      ],),),
                  Icon(Icons.arrow_forward, size: 16, color: lim.textDim),
                ],),
              ),),
    ],);
  }

  Widget _conversations() {
    final query = _search.text.trim().toLowerCase();
    final filtered = _chats
        .where((c) =>
            (!_activeOnly || c.busy) &&
            '${c.title} ${c.workspaceRoot}'.toLowerCase().contains(query),)
        .toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _heading('Every conversation, in one place.',
          'Find a thread and continue where you left off.',),
      const SizedBox(height: 24),
      TextField(
          controller: _search,
          onChanged: (_) => setState(() => _visible = 12),
          decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search),
              hintText: 'Search by title or workspace…',),),
      const SizedBox(height: 16),
      Wrap(spacing: 8, runSpacing: 8, children: [
        ChoiceChip(
            label: Text('All conversations · ${_chats.length}'),
            selected: !_activeOnly,
            onSelected: (_) => setState(() {
                  _activeOnly = false;
                  _visible = 12;
                }),),
        ChoiceChip(
            label: Text('Working · ${_chats.where((c) => c.busy).length}'),
            selected: _activeOnly,
            onSelected: (_) => setState(() {
                  _activeOnly = true;
                  _visible = 12;
                }),),
      ],),
      const SizedBox(height: 24),
      if (filtered.isEmpty)
        _empty(
            'No conversations here yet.',
            query.isNotEmpty
                ? 'Try another title or workspace name.'
                : _activeOnly
                    ? 'Conversations appear here while your agent is working.'
                    : 'Start a new conversation to get going.',)
      else
        _chatGrid(filtered.take(_visible).toList()),
      if (filtered.length > _visible)
        Padding(
            padding: const EdgeInsets.only(top: 20),
            child: OutlinedButton(
                onPressed: () => setState(() => _visible += 12),
                child: Text(
                    'Show more · ${filtered.length - _visible} remaining',),),),
    ],);
  }

  Widget _chatGrid(List<ChatSummary> chats) =>
      LayoutBuilder(builder: (context, bounds) {
        final columns = bounds.maxWidth >= 1000
            ? 3
            : bounds.maxWidth >= 600
                ? 2
                : 1;
        return Wrap(spacing: 14, runSpacing: 14, children: [
          for (final chat in chats)
            SizedBox(
              width: (bounds.maxWidth - 14 * (columns - 1)) / columns,
              child: _ChatCard(
                  chat: chat,
                  enabled: !widget.opening,
                  onOpen: () => widget.onOpenChat(chat.chatId),
                  onDelete: () => widget.onDeleteChat(chat),),
            ),
        ],);
      },);

  Widget _connections({bool all = false}) {
    final lim = LiminalTheme.of(context);
    final providers =
        all ? _providers : _providers.where((p) => p.connected).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (widget.integrationsError != null)
        Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(widget.integrationsError!,
                style: TextStyle(color: lim.danger),),),
      if (providers.isEmpty)
        _empty('Connect your first tool.',
            'Bring in your email, source code, calendar, and more.',),
      LayoutBuilder(builder: (context, bounds) {
        final columns = bounds.maxWidth >= 1000
            ? 4
            : bounds.maxWidth >= 600
                ? 3
                : bounds.maxWidth >= 400
                    ? 2
                    : 1;
        return Wrap(spacing: 12, runSpacing: 12, children: [
          for (final provider in providers)
            SizedBox(
              width: (bounds.maxWidth - 12 * (columns - 1)) / columns,
              child: LiminalInteractive(
                  onPressed: widget.onIntegrations,
                  builder: (context, hovered, focused) => Container(
                        padding: const EdgeInsets.all(18),
                        decoration: BoxDecoration(
                            color: hovered ? lim.panel : lim.surface,
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(
                                color: focused ? lim.accent : lim.border,),),
                        child: Row(children: [
                          IntegrationBrandIcon(id: provider.id, size: 28),
                          const SizedBox(width: 14),
                          Expanded(
                              child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                Text(integrationBrands[provider.id]!.title,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w600,),),
                                const SizedBox(height: 5),
                                Text(
                                    provider.connected
                                        ? 'Connected'
                                        : 'Connect',
                                    style: TextStyle(
                                        fontSize: 11,
                                        color: provider.connected
                                            ? lim.success
                                            : lim.textDim,),),
                              ],),),
                          Icon(Icons.north_east, size: 14, color: lim.textDim),
                        ],),
                      ),),
            ),
        ],);
      },),
      if (all || providers.isEmpty)
        Padding(
            padding: const EdgeInsets.only(top: 18),
            child: Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                    onPressed: widget.onIntegrations,
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('Manage connections'),),),),
    ],);
  }

  Widget _heading(String title, String subtitle) {
    final lim = LiminalTheme.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      _eyebrow('YOUR WORKSPACE'),
      const SizedBox(height: 12),
      Text(title,
          style: TextStyle(
              fontFamily: 'Space Grotesk',
              fontSize: MediaQuery.sizeOf(context).width < 650 ? 30 : 38,
              letterSpacing: -1.2,
              fontWeight: FontWeight.w500,
              height: 1.15,
              color: lim.text,),),
      const SizedBox(height: 10),
      Text(subtitle,
          style: TextStyle(fontSize: 13, height: 1.5, color: lim.textMuted),),
    ],);
  }

  Widget _eyebrow(String text) => Text(text,
      style: TextStyle(
          fontFamily: 'JetBrains Mono',
          fontSize: 9,
          letterSpacing: 1.8,
          color: LiminalTheme.of(context).textDim,),);

  Widget _sectionTitle(String title,
          {required String action, required VoidCallback onAction,}) =>
      Wrap(
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 12,
        runSpacing: 8,
        children: [
          Text(title,
              style: const TextStyle(
                  fontFamily: 'Space Grotesk',
                  fontSize: 20,
                  letterSpacing: -.4,
                  fontWeight: FontWeight.w500,),),
          TextButton.icon(
              onPressed: onAction,
              iconAlignment: IconAlignment.end,
              icon: const Icon(Icons.arrow_forward, size: 15),
              label: Text(action, style: const TextStyle(fontSize: 12)),),
        ],
      );

  Widget _surface({required Widget child}) {
    final lim = LiminalTheme.of(context);
    return Container(
        padding: const EdgeInsets.all(22),
        decoration: BoxDecoration(
            color: lim.surface,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: lim.border),),
        child: child,);
  }

  Widget _pill(String label, {bool accent = false}) {
    final lim = LiminalTheme.of(context);
    return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
            color: accent ? lim.accent.withValues(alpha: .10) : lim.panel,
            borderRadius: BorderRadius.circular(5),),
        child: Text(label,
            style: TextStyle(
                fontSize: 9,
                letterSpacing: .5,
                color: accent ? lim.accent : lim.textDim,),),);
  }

  Widget _empty(String title, String description) => _surface(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),),
        const SizedBox(height: 8),
        Text(description,
            style: TextStyle(
                fontSize: 13, color: LiminalTheme.of(context).textMuted,),),
      ],),);
}

class _NavItem extends StatelessWidget {
  const _NavItem(
      {required this.icon,
      required this.label,
      required this.onTap,
      this.selected = false,
      this.count,});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool selected;
  final String? count;
  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return LiminalInteractive(
        onPressed: onTap,
        builder: (context, hovered, focused) => Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
              decoration: BoxDecoration(
                  color: selected
                      ? lim.accent.withValues(alpha: .10)
                      : hovered
                          ? lim.panel
                          : Colors.transparent,
                  borderRadius: BorderRadius.circular(9),
                  border: Border.all(
                      color: focused
                          ? lim.accent
                          : selected
                              ? lim.accent.withValues(alpha: .16)
                              : Colors.transparent,),),
              child: Row(children: [
                Icon(icon,
                    size: 18, color: selected ? lim.accent : lim.textDim,),
                const SizedBox(width: 11),
                Expanded(
                    child: Text(label,
                        style: TextStyle(
                            fontSize: 12,
                            fontWeight:
                                selected ? FontWeight.w600 : FontWeight.w400,
                            color: selected ? lim.text : lim.textMuted,),),),
                if (count != null)
                  Text(count!,
                      style: TextStyle(
                          fontFamily: 'JetBrains Mono',
                          fontSize: 10,
                          color: lim.textDim,),),
              ],),
            ),);
  }
}

class _ChatCard extends StatelessWidget {
  const _ChatCard(
      {required this.chat,
      required this.enabled,
      required this.onOpen,
      required this.onDelete,});
  final ChatSummary chat;
  final bool enabled;
  final VoidCallback onOpen;
  final VoidCallback onDelete;
  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final parts = chat.workspaceRoot
        .replaceAll('\\', '/')
        .split('/')
        .where((p) => p.isNotEmpty)
        .toList();
    final folder = parts.isEmpty ? 'Personal workspace' : parts.last;
    return LiminalInteractive(
        enabled: enabled,
        onPressed: onOpen,
        builder: (context, hovered, focused) => Container(
              padding: const EdgeInsets.fromLTRB(20, 14, 12, 20),
              decoration: BoxDecoration(
                  color: hovered ? lim.panel : lim.surface,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                      color: focused || hovered
                          ? lim.accent.withValues(alpha: .5)
                          : lim.border,),),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Icon(chat.busy ? Icons.bolt : Icons.chat_bubble_outline,
                          size: 18,
                          color: chat.busy ? lim.accent : lim.textDim,),
                      const Spacer(),
                      Text(
                          chat.busy
                              ? 'Working'
                              : hubRelativeTime(chat.updatedAt),
                          style: TextStyle(
                              fontSize: 10,
                              color: chat.busy ? lim.accent : lim.textDim,),),
                      PopupMenuButton<String>(
                          enabled: enabled,
                          tooltip: 'Conversation actions',
                          icon: Icon(Icons.more_horiz,
                              size: 18, color: lim.textDim,),
                          onSelected: (value) {
                            if (value == 'open') onOpen();
                            if (value == 'delete') onDelete();
                          },
                          itemBuilder: (_) => [
                                const PopupMenuItem(
                                    value: 'open',
                                    child: Text('Open conversation'),),
                                PopupMenuItem(
                                    value: 'delete',
                                    child: Text('Delete',
                                        style: TextStyle(color: lim.danger),),),
                              ],),
                    ],),
                    const SizedBox(height: 7),
                    Text(
                        chat.title.trim().isEmpty
                            ? 'Untitled conversation'
                            : chat.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 14, fontWeight: FontWeight.w600,),),
                    const SizedBox(height: 14),
                    Row(children: [
                      Icon(Icons.folder_outlined, size: 13, color: lim.textDim),
                      const SizedBox(width: 6),
                      Expanded(
                          child: Tooltip(
                              message: chat.workspaceRoot,
                              child: Text(folder,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                      fontSize: 11, color: lim.textDim,),),),),
                      Padding(
                          padding: const EdgeInsets.only(right: 7),
                          child: Icon(Icons.arrow_outward,
                              size: 14,
                              color: hovered ? lim.accent : lim.textDim,),),
                    ],),
                  ],),
            ),);
  }
}

/// A quiet architectural expansion of Liminal's two offset doorframes.
class _ThresholdArchitecture extends CustomPainter {
  const _ThresholdArchitecture(this.color);
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    for (var i = 0; i < 5; i++) {
      final inset = i * 22.0;
      canvas.drawRRect(
          RRect.fromRectAndRadius(
              Rect.fromLTWH(24 + inset, 20 + inset, 200, size.height + 10),
              const Radius.circular(5),),
          paint,);
    }
  }

  @override
  bool shouldRepaint(_ThresholdArchitecture oldDelegate) =>
      oldDelegate.color != color;
}

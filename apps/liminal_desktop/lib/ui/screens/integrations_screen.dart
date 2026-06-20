import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_scope.dart';
import '../../models/integrations_snapshot.dart';
import '../../state/app_controller.dart';
import '../layout/liminal_breakpoints.dart';
import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';
import '../design_system/liminal_design_system.dart';
import '../widgets/integration_accounts_list.dart';
import '../widgets/integration_provider_row.dart';
import '../widgets/integration_provider_ui.dart';
import '../widgets/integrations_how_to_strip.dart';
import '../widgets/service_integration_card.dart';
import '../widgets/integration_brand_icon.dart';
import '../widgets/integrations_automation_section.dart';
import '../widgets/liminal_form_field.dart';
import '../widgets/liminal_page_canvas.dart';
import '../widgets/liminal_shell.dart';

class IntegrationsScreen extends StatefulWidget {
  const IntegrationsScreen({super.key});

  @override
  State<IntegrationsScreen> createState() => _IntegrationsScreenState();
}

class _IntegrationsScreenState extends State<IntegrationsScreen> {
  String? _expandedId;
  String _googleMode = 'read_write';
  String _microsoftMode = 'read_write';
  String _azureMode = 'read_write';
  String _xeroMode = 'read_write';
  bool _xeroExtended = false;
  bool _xeroFullScopes = false;
  String _slackMode = 'read_write';
  String _linearMode = 'read_write';
  String _notionMode = 'read_write';
  String _youtubeMode = 'read_write';
  bool _youtubeMonetary = true;
  String _githubMode = 'read_write';
  String _idaMode = 'read_write';
  final _idaMcpUrl = TextEditingController();

  final _mcpName = TextEditingController();
  final _mcpUrl = TextEditingController();
  final _mcpAuthEnv = TextEditingController();
  final _mcpAuthHeader = TextEditingController(text: 'Authorization');
  String _mcpAuthKind = 'none';
  bool _mcpReadOnly = false;

  final _apiName = TextEditingController();
  final _apiSpecUrl = TextEditingController();
  final _apiBaseUrl = TextEditingController();
  final _apiAuthEnv = TextEditingController();
  final _apiAuthHeader = TextEditingController(text: 'X-Api-Key');
  String _apiAuthKind = 'bearer';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final host = AppScope.of(context);
      unawaited(Future.wait([
        host.loadIntegrations(),
        host.loadHarnessSettings(),
        host.loadInboxStatus(),
      ]));
    });
  }

  @override
  void dispose() {
    _mcpName.dispose();
    _mcpUrl.dispose();
    _mcpAuthEnv.dispose();
    _mcpAuthHeader.dispose();
    _apiName.dispose();
    _apiSpecUrl.dispose();
    _apiBaseUrl.dispose();
    _apiAuthEnv.dispose();
    _apiAuthHeader.dispose();
    _idaMcpUrl.dispose();
    super.dispose();
  }

  bool _disabled(AppController host) =>
      host.integrationsBusy || host.integrationsLoading || host.chats.any((c) => c.busy);

  void _toggleExpanded(String? id) {
    setState(() => _expandedId = _expandedId == id ? null : id);
  }

  String _serviceExpandId(IntegrationServiceCard card) {
    if (card.vendor == 'azure') return 'azure:${card.serviceId}';
    return '${card.vendor}:${card.serviceId}';
  }

  Future<void> _connectService(AppController host, IntegrationServiceCard card) async {
    final mode = card.vendor == 'azure'
        ? _azureMode
        : card.vendor == 'microsoft'
            ? _microsoftMode
            : _googleMode;
    await host.connectWorkspaceService(
      vendor: card.vendor,
      serviceId: card.serviceId,
      mode: mode,
    );
  }

  Widget _serviceModeDetails({
    required IntegrationServiceCard card,
    required bool disabled,
    required String mode,
    required ValueChanged<String> onMode,
  }) {
    final hint = card.vendor == 'azure'
        ? 'Azure Resource Manager scopes for this capability only.'
        : card.vendor == 'microsoft'
            ? 'Microsoft Graph scopes for ${card.label} only.'
            : 'OAuth requests only the scopes for ${card.label}.';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(hint, style: const TextStyle(fontSize: 10, height: 1.4)),
        const SizedBox(height: 8),
        Row(
          children: [
            ChoiceChip(
              label: const Text('Read + write'),
              selected: mode == 'read_write',
              onSelected: disabled ? null : (_) => onMode('read_write'),
            ),
            const SizedBox(width: 8),
            ChoiceChip(
              label: const Text('Read only'),
              selected: mode == 'read_only',
              onSelected: disabled ? null : (_) => onMode('read_only'),
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _revokeAccount(AppController host, String provider, String accountId) async {
    await host.revokeIntegrationAccount(provider: provider, accountId: accountId);
  }

  Future<void> _xeroPrimary(AppController host, IntegrationsSnapshot snap) async {
    final needsReconnect = snap.xeroNeedsReconnect ||
        (_xeroFullScopes && snap.xeroNeedsFullReconnect) ||
        (_xeroExtended && snap.xeroNeedsExtendedReconnect);
    if (snap.xeroConnected && needsReconnect) {
      if (snap.xeroConnected) {
        await host.disconnectXero(revoke: true);
      }
      await host.connectXeroOAuth(
        mode: _xeroMode,
        extended: _xeroExtended,
        fullScopes: _xeroFullScopes,
      );
      return;
    }
    if (snap.xeroConnected) {
      await host.connectXeroOAuth(
        mode: _xeroMode,
        extended: _xeroExtended,
        fullScopes: _xeroFullScopes,
      );
      return;
    }
    await host.connectXeroOAuth(
      mode: _xeroMode,
      extended: _xeroExtended,
      fullScopes: _xeroFullScopes,
    );
  }

  Future<void> _slackPrimary(AppController host, IntegrationsSnapshot snap) async {
    if (snap.slackConnected) {
      await host.connectSlackOAuth(mode: _slackMode);
      return;
    }
    await host.connectSlackOAuth(mode: _slackMode);
  }

  Future<void> _linearPrimary(AppController host, IntegrationsSnapshot snap) async {
    if (snap.linearConnected) {
      await host.connectLinearOAuth(mode: _linearMode);
      return;
    }
    await host.connectLinearOAuth(mode: _linearMode);
  }

  Future<void> _notionPrimary(AppController host, IntegrationsSnapshot snap) async {
    if (snap.notionConnected) {
      await host.connectNotionOAuth(mode: _notionMode);
      return;
    }
    await host.connectNotionOAuth(mode: _notionMode);
  }

  Future<void> _youtubePrimary(AppController host, IntegrationsSnapshot snap) async {
    if (snap.youtubeConnected && !snap.youtubeNeedsReconnect) {
      await host.connectYoutubeOAuth(mode: _youtubeMode, monetary: _youtubeMonetary);
      return;
    }
    await host.connectYoutubeOAuth(mode: _youtubeMode, monetary: _youtubeMonetary);
  }

  Future<void> _idaPrimary(AppController host, IntegrationsSnapshot snap) async {
    if (snap.idaConnected) {
      await host.disconnectIda();
      return;
    }
    final url = _idaMcpUrl.text.trim();
    await host.connectIda(
      mode: _idaMode,
      mcpUrl: url.isEmpty ? null : url,
    );
  }

  Future<void> _githubPrimary(AppController host, IntegrationsSnapshot snap) async {
    if (snap.githubConnected) {
      await host.connectGithubOAuth(mode: _githubMode, attach: false);
      return;
    }
    if (snap.github.accounts.isEmpty) {
      await host.connectGithubOAuth(mode: _githubMode);
      return;
    }
    await host.connectGithub(mode: _githubMode);
  }

  @override
  Widget build(BuildContext context) {
    final host = AppScope.watch(context);
    final lim = LiminalTheme.of(context);
    final snap = host.integrations;
    final disabled = _disabled(host);

    return LiminalShell(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
        title: const Text('Integrations'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: disabled ? null : () => host.loadIntegrations(),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: LiminalPageCanvas(
        child: SingleChildScrollView(
          padding: LiminalBreakpoints.pagePadding(context),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const IntegrationsHowToStrip(),
              const SizedBox(height: 12),
              Text(
                'Connect only what you need — each card is one service with its own OAuth scopes. '
                'Tap a card for read/write mode and account options.',
                style: TextStyle(color: lim.textMuted, fontSize: 12, height: 1.45),
              ),
              if (host.integrationsError != null) ...[
                const SizedBox(height: 12),
                Text(host.integrationsError!, style: TextStyle(color: lim.danger, fontSize: 13)),
              ],
              if (host.chats.any((c) => c.busy)) ...[
                const SizedBox(height: 12),
                Text(
                  'An agent turn is running — wait before changing integrations.',
                  style: TextStyle(color: lim.accent, fontSize: 13),
                ),
              ],
              const SizedBox(height: 16),
              ..._integrationGroups(context, host, snap, disabled, lim),
              const SizedBox(height: 20),
              IntegrationsAutomationSection(
                host: host,
                integrations: snap,
                inbox: host.inbox,
                harness: host.harnessSettings,
                busy: disabled,
                onOpenInbox: () => showInboxPanelSheet(context, host),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _integrationGroups(
    BuildContext context,
    AppController host,
    IntegrationsSnapshot snap,
    bool disabled,
    LiminalTokens lim,
  ) {
    Widget oauthModeRow({
      required String mode,
      required bool modeLocked,
      required ValueChanged<String> onMode,
    }) {
      return Row(
        children: [
          ChoiceChip(
            label: const Text('Read + write'),
            selected: mode == 'read_write',
            onSelected: disabled || modeLocked ? null : (_) => onMode('read_write'),
          ),
          const SizedBox(width: 8),
          ChoiceChip(
            label: const Text('Read only'),
            selected: mode == 'read_only',
            onSelected: disabled || modeLocked ? null : (_) => onMode('read_only'),
          ),
        ],
      );
    }

    return [
      IntegrationCategorySection(
        title: 'Google Workspace',
        subtitle: 'One Google account — connect Gmail, Calendar, Drive, Docs, and more individually.',
        cards: snap.googleServiceCards,
        expandedId: _expandedId,
        disabled: disabled,
        expandIdFor: _serviceExpandId,
        onToggle: (card) {
          final id = _serviceExpandId(card);
          _toggleExpanded(_expandedId == id ? null : id);
        },
        onConnect: (card) => unawaited(_connectService(host, card)),
        detailsFor: (card) => _serviceModeDetails(
          card: card,
          disabled: disabled,
          mode: _googleMode,
          onMode: (m) => setState(() => _googleMode = m),
        ),
        footer: _expandedId == 'google-accounts'
            ? IntegrationAccountsList(
                accounts: [
                  for (final a in snap.google.accounts)
                    IntegrationAccountEntry(
                      accountId: a.accountId,
                      label: a.email ?? a.accountId,
                      meta: '${a.scopes.length} scopes',
                    ),
                ],
                disabled: disabled,
                onRemove: (id) => _revokeAccount(host, 'google', id),
                onDisconnectAll: () => host.disconnectGoogle(revoke: true),
              )
            : TextButton(
                onPressed: disabled
                    ? null
                    : () => _toggleExpanded(_expandedId == 'google-accounts' ? null : 'google-accounts'),
                child: Text(
                  snap.google.accounts.isNotEmpty
                      ? 'Google accounts (${snap.google.accounts.length})'
                      : 'Google accounts',
                ),
              ),
      ),
      IntegrationCategorySection(
        title: 'Microsoft',
        subtitle: 'Outlook, Teams, OneDrive, and Azure cloud — each service connects with its own scopes.',
        cards: snap.microsoftServiceCards,
        expandedId: _expandedId,
        disabled: disabled,
        expandIdFor: _serviceExpandId,
        onToggle: (card) {
          final id = _serviceExpandId(card);
          _toggleExpanded(_expandedId == id ? null : id);
        },
        onConnect: (card) => unawaited(_connectService(host, card)),
        detailsFor: (card) => _serviceModeDetails(
          card: card,
          disabled: disabled,
          mode: card.vendor == 'azure' ? _azureMode : _microsoftMode,
          onMode: (m) => setState(() {
            if (card.vendor == 'azure') {
              _azureMode = m;
            } else {
              _microsoftMode = m;
            }
          }),
        ),
        footer: _expandedId == 'microsoft-accounts'
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final a in snap.microsoft.accounts)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Text(
                        'M365: ${a.email ?? a.accountId} — ${a.scopes.length} scopes',
                        style: TextStyle(color: lim.success, fontSize: 11),
                      ),
                    ),
                  for (final a in snap.azure.accounts)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Text(
                        'Azure: ${a.email ?? a.accountId} — ${a.scopes.length} scopes',
                        style: TextStyle(color: lim.success, fontSize: 11),
                      ),
                    ),
                  Wrap(
                    spacing: 8,
                    children: [
                      LiminalButton(
                        label: 'Revoke Microsoft 365',
                        dense: true,
                        variant: LiminalButtonVariant.danger,
                        onPressed: disabled || snap.microsoft.accounts.isEmpty
                            ? null
                            : () => host.disconnectMicrosoft(revoke: true),
                      ),
                      LiminalButton(
                        label: 'Revoke Azure',
                        dense: true,
                        variant: LiminalButtonVariant.danger,
                        onPressed: disabled || snap.azure.accounts.isEmpty
                            ? null
                            : () => host.disconnectAzure(revoke: true),
                      ),
                    ],
                  ),
                ],
              )
            : TextButton(
                onPressed: disabled
                    ? null
                    : () => _toggleExpanded(
                          _expandedId == 'microsoft-accounts' ? null : 'microsoft-accounts',
                        ),
                child: Text(
                  'Microsoft accounts (${snap.microsoft.accounts.length + snap.azure.accounts.length})',
                ),
              ),
      ),
      IntegrationProviderGroup(
        title: 'Developer tools',
        subtitle: 'GitHub repos and IDA Pro reverse engineering',
        children: [
          IntegrationProviderRow(
            brandId: IntegrationBrandId.ida,
            presentation: integrationPresentation(
              brandId: IntegrationBrandId.ida,
              snap: snap,
              busy: host.integrationsBusy,
            ),
            expanded: _expandedId == 'ida',
            disabled: disabled,
            onToggleDetails: () => _toggleExpanded(_expandedId == 'ida' ? null : 'ida'),
            onAction: () => unawaited(_idaPrimary(host, snap)),
            details: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Reverse engineering via ida-pro-mcp. Headless needs IDA 9.0 SP1+; otherwise start MCP in IDA (Edit → Plugins → MCP).',
                  style: TextStyle(color: lim.textMuted, fontSize: 12, height: 1.4),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _idaMcpUrl,
                  enabled: !disabled && !snap.idaConnected,
                  decoration: const InputDecoration(
                    labelText: 'MCP URL override (optional)',
                    hintText: 'http://127.0.0.1:13337/mcp',
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 8),
                oauthModeRow(
                  mode: _idaMode,
                  modeLocked: snap.idaConnected,
                  onMode: (m) => setState(() => _idaMode = m),
                ),
              ],
            ),
          ),
          IntegrationProviderRow(
            brandId: IntegrationBrandId.github,
            presentation: integrationPresentation(
              brandId: IntegrationBrandId.github,
              snap: snap,
              busy: host.integrationsBusy,
            ),
            expanded: _expandedId == 'github',
            disabled: disabled,
            onToggleDetails: () => _toggleExpanded(_expandedId == 'github' ? null : 'github'),
            onAction: () => unawaited(_githubPrimary(host, snap)),
            showDivider: false,
            details: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                IntegrationAccountsList(
                  accounts: [
                    for (final a in snap.github.accounts)
                      IntegrationAccountEntry(
                        accountId: a.accountId,
                        label: a.login ?? a.email ?? a.accountId,
                        meta: '${a.scopes.length} scopes',
                      ),
                  ],
                  disabled: disabled,
                  onRemove: (id) => _revokeAccount(host, 'github', id),
                  onDisconnectAll: () => host.disconnectGithub(revoke: true),
                ),
                Text(
                  'Sign in with GitHub — your agent can work with repos and pull requests.',
                  style: TextStyle(color: lim.textMuted, fontSize: 12, height: 1.4),
                ),
                const SizedBox(height: 8),
                oauthModeRow(
                  mode: _githubMode,
                  modeLocked: snap.githubConnected,
                  onMode: (m) => setState(() => _githubMode = m),
                ),
              ],
            ),
          ),
        ],
      ),
      const SizedBox(height: 16),
      IntegrationProviderGroup(
        title: 'Team & docs',
        subtitle: 'One sign-in — tools attach automatically',
        children: [
          IntegrationProviderRow(
            brandId: IntegrationBrandId.slack,
            presentation: integrationPresentation(brandId: IntegrationBrandId.slack, snap: snap),
            expanded: _expandedId == 'slack',
            disabled: disabled,
            onToggleDetails: () => _toggleExpanded('slack'),
            onAction: () => unawaited(_slackPrimary(host, snap)),
            details: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                IntegrationAccountsList(
                  accounts: [
                    for (final a in snap.slack.accounts)
                      IntegrationAccountEntry(
                        accountId: a.accountId,
                        label: a.teamName ?? a.email ?? a.accountId,
                      ),
                  ],
                  disabled: disabled,
                  onRemove: (id) => _revokeAccount(host, 'slack', id),
                  onDisconnectAll: () => host.disconnectSlack(revoke: true),
                ),
                Text(
                  'Sign in with Slack so your agent can read channels and post updates.',
                  style: TextStyle(color: lim.textMuted, fontSize: 12, height: 1.4),
                ),
                const SizedBox(height: 8),
                oauthModeRow(
                  mode: _slackMode,
                  modeLocked: snap.slackConnected,
                  onMode: (m) => setState(() => _slackMode = m),
                ),
              ],
            ),
          ),
          IntegrationProviderRow(
            brandId: IntegrationBrandId.linear,
            presentation: integrationPresentation(brandId: IntegrationBrandId.linear, snap: snap),
            expanded: _expandedId == 'linear',
            disabled: disabled,
            onToggleDetails: () => _toggleExpanded('linear'),
            onAction: () => unawaited(_linearPrimary(host, snap)),
            details: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                IntegrationAccountsList(
                  accounts: [
                    for (final a in snap.linear.accounts)
                      IntegrationAccountEntry(
                        accountId: a.accountId,
                        label: a.organizationName ?? a.email ?? a.accountId,
                      ),
                  ],
                  disabled: disabled,
                  onRemove: (id) => _revokeAccount(host, 'linear', id),
                  onDisconnectAll: () => host.disconnectLinear(revoke: true),
                ),
                Text(
                  'Sign in with Linear so your agent can list issues and create tickets.',
                  style: TextStyle(color: lim.textMuted, fontSize: 12, height: 1.4),
                ),
                const SizedBox(height: 8),
                oauthModeRow(
                  mode: _linearMode,
                  modeLocked: snap.linearConnected,
                  onMode: (m) => setState(() => _linearMode = m),
                ),
              ],
            ),
          ),
          IntegrationProviderRow(
            brandId: IntegrationBrandId.notion,
            presentation: integrationPresentation(brandId: IntegrationBrandId.notion, snap: snap),
            expanded: _expandedId == 'notion',
            disabled: disabled,
            onToggleDetails: () => _toggleExpanded('notion'),
            onAction: () => unawaited(_notionPrimary(host, snap)),
            showDivider: false,
            details: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                IntegrationAccountsList(
                  accounts: [
                    for (final a in snap.notion.accounts)
                      IntegrationAccountEntry(
                        accountId: a.accountId,
                        label: a.workspaceName ?? a.email ?? a.accountId,
                      ),
                  ],
                  disabled: disabled,
                  onRemove: (id) => _revokeAccount(host, 'notion', id),
                  onDisconnectAll: () => host.disconnectNotion(revoke: true),
                ),
                Text(
                  'Sign in with Notion so your agent can search and update pages.',
                  style: TextStyle(color: lim.textMuted, fontSize: 12, height: 1.4),
                ),
                const SizedBox(height: 8),
                oauthModeRow(
                  mode: _notionMode,
                  modeLocked: snap.notionConnected,
                  onMode: (m) => setState(() => _notionMode = m),
                ),
              ],
            ),
          ),
          IntegrationProviderRow(
            brandId: IntegrationBrandId.youtube,
            presentation: integrationPresentation(brandId: IntegrationBrandId.youtube, snap: snap),
            expanded: _expandedId == 'youtube',
            disabled: disabled,
            onToggleDetails: () => _toggleExpanded('youtube'),
            onAction: () => unawaited(_youtubePrimary(host, snap)),
            showDivider: false,
            details: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                IntegrationAccountsList(
                  accounts: [
                    for (final a in snap.youtube.accounts)
                      IntegrationAccountEntry(
                        accountId: a.accountId,
                        label: a.channelTitle ?? a.customUrl ?? a.email ?? a.accountId,
                        meta: a.channelId,
                      ),
                  ],
                  disabled: disabled,
                  onRemove: (id) => _revokeAccount(host, 'youtube', id),
                  onDisconnectAll: () => host.disconnectYoutube(revoke: true),
                ),
                Text(
                  'Connect a YouTube channel separately from Google Workspace — Studio analytics and video tools.',
                  style: TextStyle(color: lim.textMuted, fontSize: 12, height: 1.4),
                ),
                if (snap.youtubeNeedsReconnect) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Reconnect to grant analytics scopes (and revenue metrics if enabled).',
                    style: TextStyle(color: lim.warn, fontSize: 12, height: 1.4),
                  ),
                ],
                const SizedBox(height: 8),
                oauthModeRow(
                  mode: _youtubeMode,
                  modeLocked: snap.youtubeConnected,
                  onMode: (m) => setState(() => _youtubeMode = m),
                ),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: const Text(
                    'Include revenue analytics (Partner Program)',
                    style: TextStyle(fontSize: 12),
                  ),
                  value: _youtubeMonetary,
                  onChanged: disabled || snap.youtubeConnected
                      ? null
                      : (v) => setState(() => _youtubeMonetary = v ?? false),
                  controlAffinity: ListTileControlAffinity.leading,
                ),
              ],
            ),
          ),
        ],
      ),
      const SizedBox(height: 16),
      IntegrationProviderGroup(
        title: 'Finance',
        subtitle: 'Accounting tools for your agent',
        children: [
          IntegrationProviderRow(
            brandId: IntegrationBrandId.xero,
            presentation: integrationPresentation(
              brandId: IntegrationBrandId.xero,
              snap: snap,
              xeroFullScopes: _xeroFullScopes,
              xeroExtended: _xeroExtended,
            ),
            expanded: _expandedId == 'xero',
            disabled: disabled,
            onToggleDetails: () => _toggleExpanded('xero'),
            onAction: () => unawaited(_xeroPrimary(host, snap)),
            showDivider: false,
            details: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                IntegrationAccountsList(
                  accounts: [
                    for (final a in snap.xero.accounts)
                      IntegrationAccountEntry(
                        accountId: a.accountId,
                        label: a.tenantName ?? a.email ?? a.accountId,
                        meta: a.tenantId,
                      ),
                  ],
                  disabled: disabled,
                  onRemove: (id) => _revokeAccount(host, 'xero', id),
                  onDisconnectAll: () => host.disconnectXero(revoke: true),
                ),
                Text(
                  'Sign in with your Xero account — invoices and contacts sync locally.',
                  style: TextStyle(color: lim.textMuted, fontSize: 12, height: 1.4),
                ),
                if (snap.xeroNeedsReconnect) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Reconnect with Extended and Full scopes off if you saw invalid_scope.',
                    style: TextStyle(color: lim.warn, fontSize: 12, height: 1.4),
                  ),
                ] else if (snap.xeroNeedsFullReconnect) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Enable Full accounting scopes below, then Reconnect for reports/budgets.',
                    style: TextStyle(color: lim.warn, fontSize: 12, height: 1.4),
                  ),
                ] else if (snap.xeroNeedsExtendedReconnect) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Enable Extended APIs below, then Reconnect for files/projects/payroll.',
                    style: TextStyle(color: lim.warn, fontSize: 12, height: 1.4),
                  ),
                ],
                const SizedBox(height: 8),
                oauthModeRow(
                  mode: _xeroMode,
                  modeLocked: snap.xeroConnected,
                  onMode: (m) => setState(() => _xeroMode = m),
                ),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: const Text(
                    'Full accounting scopes (reports, budgets)',
                    style: TextStyle(fontSize: 12),
                  ),
                  value: _xeroFullScopes,
                  onChanged: disabled || snap.xeroConnected
                      ? null
                      : (v) => setState(() => _xeroFullScopes = v ?? false),
                  controlAffinity: ListTileControlAffinity.leading,
                ),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: const Text(
                    'Extended APIs (files, projects, payroll)',
                    style: TextStyle(fontSize: 12),
                  ),
                  value: _xeroExtended,
                  onChanged: disabled || snap.xeroConnected
                      ? null
                      : (v) => setState(() => _xeroExtended = v ?? false),
                  controlAffinity: ListTileControlAffinity.leading,
                ),
              ],
            ),
          ),
        ],
      ),
      const SizedBox(height: 16),
      IntegrationProviderGroup(
        title: 'Custom',
        subtitle: 'MCP servers and OpenAPI specs',
        children: [
          IntegrationProviderRow(
            brandId: IntegrationBrandId.advanced,
            presentation: integrationPresentation(brandId: IntegrationBrandId.advanced, snap: snap),
            expanded: _expandedId == 'advanced',
            disabled: disabled,
            onToggleDetails: () => _toggleExpanded('advanced'),
            onAction: () => _toggleExpanded('advanced'),
            showDivider: false,
            details: _AdvancedSection(
              snap: snap,
              disabled: disabled,
              mcpName: _mcpName,
              mcpUrl: _mcpUrl,
              mcpAuthKind: _mcpAuthKind,
              mcpAuthHeader: _mcpAuthHeader,
              mcpAuthEnv: _mcpAuthEnv,
              mcpReadOnly: _mcpReadOnly,
              onMcpReadOnly: (v) => setState(() => _mcpReadOnly = v),
              onMcpAuthKind: (v) => setState(() => _mcpAuthKind = v),
              onAttachMcp: () => host.attachIntegrationMcp(
                name: _mcpName.text.trim(),
                url: _mcpUrl.text.trim(),
                readOnly: _mcpReadOnly,
                authKind: _mcpAuthKind,
                authEnv: _mcpAuthEnv.text,
                authHeader: _mcpAuthHeader.text,
              ),
              onDetachMcp: host.detachIntegrationMcp,
              apiName: _apiName,
              apiSpecUrl: _apiSpecUrl,
              apiBaseUrl: _apiBaseUrl,
              apiAuthKind: _apiAuthKind,
              apiAuthEnv: _apiAuthEnv,
              apiAuthHeader: _apiAuthHeader,
              onApiAuthKind: (v) => setState(() => _apiAuthKind = v),
              onConnectOpenApi: () => host.connectIntegrationOpenApi(
                name: _apiName.text.trim(),
                specUrl: _apiSpecUrl.text.trim(),
                baseUrl: _apiBaseUrl.text.trim(),
                authKind: _apiAuthKind,
                authEnv: _apiAuthEnv.text,
                authHeader: _apiAuthHeader.text,
              ),
              onDisconnectOpenApi: host.disconnectIntegrationOpenApi,
            ),
          ),
        ],
      ),
    ];
  }
}

class _AdvancedSection extends StatelessWidget {
  const _AdvancedSection({
    required this.snap,
    required this.disabled,
    required this.mcpName,
    required this.mcpUrl,
    required this.mcpAuthKind,
    required this.mcpAuthHeader,
    required this.mcpAuthEnv,
    required this.mcpReadOnly,
    required this.onMcpReadOnly,
    required this.onMcpAuthKind,
    required this.onAttachMcp,
    required this.onDetachMcp,
    required this.apiName,
    required this.apiSpecUrl,
    required this.apiBaseUrl,
    required this.apiAuthKind,
    required this.apiAuthEnv,
    required this.apiAuthHeader,
    required this.onApiAuthKind,
    required this.onConnectOpenApi,
    required this.onDisconnectOpenApi,
  });

  final IntegrationsSnapshot snap;
  final bool disabled;
  final TextEditingController mcpName;
  final TextEditingController mcpUrl;
  final String mcpAuthKind;
  final TextEditingController mcpAuthHeader;
  final TextEditingController mcpAuthEnv;
  final bool mcpReadOnly;
  final ValueChanged<bool> onMcpReadOnly;
  final ValueChanged<String> onMcpAuthKind;
  final Future<bool> Function() onAttachMcp;
  final Future<bool> Function(String name) onDetachMcp;
  final TextEditingController apiName;
  final TextEditingController apiSpecUrl;
  final TextEditingController apiBaseUrl;
  final String apiAuthKind;
  final TextEditingController apiAuthEnv;
  final TextEditingController apiAuthHeader;
  final ValueChanged<String> onApiAuthKind;
  final Future<bool> Function() onConnectOpenApi;
  final Future<bool> Function(String name) onDisconnectOpenApi;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Custom MCP', style: TextStyle(color: lim.accent, fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(child: LiminalTextField(controller: mcpName, label: 'Name', enabled: !disabled)),
            const SizedBox(width: 12),
            Expanded(
              flex: 2,
              child: LiminalTextField(controller: mcpUrl, label: 'MCP URL', enabled: !disabled),
            ),
          ],
        ),
        const SizedBox(height: 8),
        _AuthRow(
          authKind: mcpAuthKind,
          authHeader: mcpAuthHeader,
          authEnv: mcpAuthEnv,
          disabled: disabled,
          onKind: onMcpAuthKind,
        ),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: mcpReadOnly,
          onChanged: disabled ? null : (v) => onMcpReadOnly(v ?? false),
          title: const Text('Read-only'),
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton(
            onPressed: disabled || mcpName.text.trim().isEmpty || mcpUrl.text.trim().isEmpty ? null : () => onAttachMcp(),
            child: const Text('Attach MCP'),
          ),
        ),
        ...snap.customMcp.map(
          (c) => _ConnectionTile(
            title: c.name,
            subtitle: c.serverUrl ?? '',
            meta: '${c.toolCount} tools',
            disabled: disabled,
            onRemove: () => onDetachMcp(c.name),
          ),
        ),
        const SizedBox(height: 16),
        Text('OpenAPI', style: TextStyle(color: lim.accent, fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(child: LiminalTextField(controller: apiName, label: 'Name', enabled: !disabled)),
            const SizedBox(width: 12),
            Expanded(
              flex: 2,
              child: LiminalTextField(controller: apiSpecUrl, label: 'Spec URL', enabled: !disabled),
            ),
          ],
        ),
        const SizedBox(height: 8),
        FilledButton(
          onPressed: disabled || apiName.text.trim().isEmpty || apiSpecUrl.text.trim().isEmpty
              ? null
              : () => onConnectOpenApi(),
          child: const Text('Connect OpenAPI'),
        ),
        ...snap.openApi.map(
          (c) => _ConnectionTile(
            title: c.name,
            subtitle: c.specUrl ?? '',
            meta: '${c.toolCount} ops',
            disabled: disabled,
            onRemove: () => onDisconnectOpenApi(c.name),
          ),
        ),
      ],
    );
  }
}

class _AuthRow extends StatelessWidget {
  const _AuthRow({
    required this.authKind,
    required this.authHeader,
    required this.authEnv,
    required this.disabled,
    required this.onKind,
  });

  final String authKind;
  final TextEditingController authHeader;
  final TextEditingController authEnv;
  final bool disabled;
  final ValueChanged<String> onKind;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 130,
          child: DropdownButtonFormField<String>(
            value: authKind,
            decoration: const InputDecoration(labelText: 'Auth'),
            items: const [
              DropdownMenuItem(value: 'none', child: Text('none')),
              DropdownMenuItem(value: 'bearer', child: Text('bearer')),
              DropdownMenuItem(value: 'header', child: Text('header')),
              DropdownMenuItem(value: 'basic', child: Text('basic')),
            ],
            onChanged: disabled ? null : (v) => onKind(v ?? 'none'),
          ),
        ),
        const SizedBox(width: 12),
        if (authKind == 'header')
          Expanded(child: LiminalTextField(controller: authHeader, label: 'Header', enabled: !disabled)),
        if (authKind != 'none') ...[
          if (authKind == 'header') const SizedBox(width: 12),
          Expanded(
            child: LiminalTextField(controller: authEnv, label: 'Env var', enabled: !disabled),
          ),
        ],
      ],
    );
  }
}

class _ConnectionTile extends StatelessWidget {
  const _ConnectionTile({
    required this.title,
    required this.subtitle,
    required this.meta,
    required this.disabled,
    required this.onRemove,
  });

  final String title;
  final String subtitle;
  final String meta;
  final bool disabled;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(color: lim.accent, fontWeight: FontWeight.w600)),
                if (subtitle.isNotEmpty)
                  Text(
                    subtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: LiminalTheme.mono(context, fontSize: 11, color: lim.textDim),
                  ),
                Text(meta, style: TextStyle(color: lim.textMuted, fontSize: 11)),
              ],
            ),
          ),
          TextButton(
            onPressed: disabled ? null : onRemove,
            style: TextButton.styleFrom(foregroundColor: lim.danger.withValues(alpha: 0.85)),
            child: const Text('Detach'),
          ),
        ],
      ),
    );
  }
}

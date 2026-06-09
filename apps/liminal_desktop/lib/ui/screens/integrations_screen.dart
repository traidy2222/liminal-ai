import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_scope.dart';
import '../../models/integrations_snapshot.dart';
import '../../state/app_controller.dart';
import '../layout/liminal_breakpoints.dart';
import '../theme/liminal_theme_extension.dart';
import '../widgets/integration_brand_icon.dart';
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
  String _xeroMode = 'read_write';
  String _slackMode = 'read_write';
  String _linearMode = 'read_write';
  String _notionMode = 'read_write';
  String _githubMode = 'read_write';
  final Set<String> _googleServices = {};
  final Set<String> _microsoftServices = {};
  bool _servicesInitialized = false;
  bool _microsoftServicesInitialized = false;

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
      unawaited(AppScope.of(context).loadIntegrations());
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
    super.dispose();
  }

  bool _disabled(AppController host) =>
      host.integrationsBusy || host.integrationsLoading || host.chats.any((c) => c.busy);

  List<String> _selectedServices(IntegrationsSnapshot snap) {
    if (_googleServices.isEmpty && !_servicesInitialized && snap.google.services.isNotEmpty) {
      return snap.google.services;
    }
    return _googleServices.isEmpty ? snap.google.services : _googleServices.toList();
  }

  List<String> _selectedMicrosoftServices(IntegrationsSnapshot snap) {
    if (_microsoftServices.isEmpty &&
        !_microsoftServicesInitialized &&
        snap.microsoft.services.isNotEmpty) {
      return snap.microsoft.services;
    }
    return _microsoftServices.isEmpty
        ? snap.microsoft.services
        : _microsoftServices.toList();
  }

  void _toggleExpanded(String id) {
    setState(() => _expandedId = _expandedId == id ? null : id);
  }

  Future<void> _attachGoogleToolsIfNeeded(
    AppController host,
    List<String> services,
  ) async {
    if (host.integrations.googleConnected || host.integrations.google.accounts.isEmpty) {
      return;
    }
    if (host.chats.any((c) => c.busy)) return;
    await host.connectGoogleWorkspace(services: services, mode: _googleMode);
  }

  Future<void> _googlePrimary(AppController host, IntegrationsSnapshot snap, List<String> services) async {
    if (snap.googleConnected) {
      await host.disconnectGoogle(revoke: true);
      return;
    }
    if (snap.google.accounts.isEmpty) {
      await host.connectGoogleOAuth(services: services, mode: _googleMode);
      await _attachGoogleToolsIfNeeded(host, services);
      return;
    }
    await host.connectGoogleWorkspace(services: services, mode: _googleMode);
  }

  Future<void> _microsoftPrimary(
    AppController host,
    IntegrationsSnapshot snap,
    List<String> services,
  ) async {
    if (snap.microsoftConnected) {
      await host.disconnectMicrosoft(revoke: true);
      return;
    }
    if (snap.microsoft.accounts.isEmpty) {
      await host.connectMicrosoftOAuth(services: services, mode: _microsoftMode);
      return;
    }
    await host.connectMicrosoft365(services: services, mode: _microsoftMode);
  }

  Future<void> _xeroPrimary(AppController host, IntegrationsSnapshot snap) async {
    if (snap.xeroConnected) {
      await host.disconnectXero(revoke: true);
      return;
    }
    await host.connectXeroOAuth(mode: _xeroMode);
  }

  Future<void> _slackPrimary(AppController host, IntegrationsSnapshot snap) async {
    if (snap.slackConnected) {
      await host.disconnectSlack(revoke: true);
      return;
    }
    await host.connectSlackOAuth(mode: _slackMode);
  }

  Future<void> _linearPrimary(AppController host, IntegrationsSnapshot snap) async {
    if (snap.linearConnected) {
      await host.disconnectLinear(revoke: true);
      return;
    }
    await host.connectLinearOAuth(mode: _linearMode);
  }

  Future<void> _notionPrimary(AppController host, IntegrationsSnapshot snap) async {
    if (snap.notionConnected) {
      await host.disconnectNotion(revoke: true);
      return;
    }
    await host.connectNotionOAuth(mode: _notionMode);
  }

  Future<void> _githubPrimary(AppController host, IntegrationsSnapshot snap) async {
    if (snap.githubConnected) {
      await host.disconnectGithub(revoke: true);
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
    if (!_servicesInitialized && snap.google.services.isNotEmpty) {
      _googleServices.addAll(snap.google.services);
      _servicesInitialized = true;
    }
    if (!_microsoftServicesInitialized && snap.microsoft.services.isNotEmpty) {
      _microsoftServices.addAll(snap.microsoft.services);
      _microsoftServicesInitialized = true;
    }
    final disabled = _disabled(host);
    final services = _selectedServices(snap);
    final msServices = _selectedMicrosoftServices(snap);

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
              Text(
                'Connect the apps you use every day. Sign in once — your agent can read email, files, code, and more.',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: lim.textMuted,
                      height: 1.4,
                    ),
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
              LayoutBuilder(
                builder: (context, constraints) {
                  final tileWidth = constraints.maxWidth >= 720
                      ? (constraints.maxWidth - 24) / 3
                      : constraints.maxWidth >= 480
                          ? (constraints.maxWidth - 12) / 2
                          : constraints.maxWidth;
                  return Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: [
                      SizedBox(
                        width: _expandedId == 'google' ? constraints.maxWidth : tileWidth.clamp(148, 280),
                        child: _IntegrationCard(
                          brandId: IntegrationBrandId.google,
                          statusLine: snap.googleConnected
                              ? 'Ready · ${snap.googleToolCount} tools'
                              : snap.google.accounts.isNotEmpty
                                  ? host.integrationsBusy
                                      ? 'Finishing sign-in…'
                                      : 'Signed in — tap Enable tools'
                                  : integrationBrands[IntegrationBrandId.google]!.tagline,
                          connected: snap.googleConnected,
                          expanded: _expandedId == 'google',
                          onToggle: () => _toggleExpanded('google'),
                          primaryLabel: snap.googleConnected
                              ? 'Disconnect'
                              : snap.google.accounts.isNotEmpty
                                  ? 'Enable tools'
                                  : 'Connect',
                          primaryDanger: snap.googleConnected,
                          disabled: disabled,
                          onPrimary: () => unawaited(_googlePrimary(host, host.integrations, services)),
                          child: _GoogleDetails(
                  snap: snap,
                  disabled: disabled,
                  mode: _googleMode,
                  services: services,
                  selected: _googleServices,
                  onMode: (m) => setState(() => _googleMode = m),
                  onToggleService: (id) => setState(() {
                    if (_googleServices.contains(id)) {
                      _googleServices.remove(id);
                    } else {
                      _googleServices.add(id);
                    }
                  }),
                  onReattach: () => host.connectGoogleWorkspace(services: services, mode: _googleMode),
                  onAttachCalendar: () =>
                      host.connectGoogleWorkspace(services: ['calendar'], mode: _googleMode),
                  onRevoke: () => host.disconnectGoogle(revoke: true),
                ),
                        ),
                      ),
                      SizedBox(
                        width: _expandedId == 'microsoft' ? constraints.maxWidth : tileWidth.clamp(148, 280),
                        child: _IntegrationCard(
                          brandId: IntegrationBrandId.microsoft,
                          statusLine: snap.microsoftConnected
                              ? 'Ready · ${snap.microsoftToolCount} tools'
                              : snap.microsoft.accounts.isNotEmpty
                                  ? 'Signed in — tap Connect'
                                  : integrationBrands[IntegrationBrandId.microsoft]!.tagline,
                          connected: snap.microsoftConnected,
                          expanded: _expandedId == 'microsoft',
                          onToggle: () => _toggleExpanded('microsoft'),
                          primaryLabel: snap.microsoftConnected ? 'Disconnect' : 'Connect',
                          primaryDanger: snap.microsoftConnected,
                          disabled: disabled,
                          onPrimary: () => unawaited(_microsoftPrimary(host, host.integrations, msServices)),
                          child: _MicrosoftDetails(
                            snap: snap,
                            disabled: disabled,
                            mode: _microsoftMode,
                            services: msServices,
                            selected: _microsoftServices,
                            onMode: (m) => setState(() => _microsoftMode = m),
                            onToggleService: (id) => setState(() {
                              if (_microsoftServices.contains(id)) {
                                _microsoftServices.remove(id);
                              } else {
                                _microsoftServices.add(id);
                              }
                            }),
                            onReattach: () => host.connectMicrosoft365(
                              services: msServices,
                              mode: _microsoftMode,
                            ),
                            onRevoke: () => host.disconnectMicrosoft(revoke: true),
                          ),
                        ),
                      ),
                      SizedBox(
                        width: _expandedId == 'xero' ? constraints.maxWidth : tileWidth.clamp(148, 280),
                        child: _IntegrationCard(
                          brandId: IntegrationBrandId.xero,
                          statusLine: snap.xeroConnected
                              ? 'Ready · ${snap.xeroAccountLabel}'
                              : integrationBrands[IntegrationBrandId.xero]!.tagline,
                          connected: snap.xeroConnected,
                          expanded: _expandedId == 'xero',
                          onToggle: () => _toggleExpanded('xero'),
                          primaryLabel: snap.xeroConnected ? 'Disconnect' : 'Connect',
                          primaryDanger: snap.xeroConnected,
                          disabled: disabled,
                          onPrimary: () => unawaited(_xeroPrimary(host, host.integrations)),
                          child: Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Sign in with your Xero account — invoices and contacts sync locally.',
                                  style: TextStyle(color: lim.textMuted, fontSize: 12, height: 1.4),
                                ),
                                const SizedBox(height: 8),
                                Row(
                                  children: [
                                    Radio<String>(
                                      value: 'read_write',
                                      groupValue: _xeroMode,
                                      onChanged: disabled || snap.xeroConnected
                                          ? null
                                          : (v) => setState(() => _xeroMode = v ?? 'read_write'),
                                    ),
                                    const Text('Read + write'),
                                    const SizedBox(width: 12),
                                    Radio<String>(
                                      value: 'read_only',
                                      groupValue: _xeroMode,
                                      onChanged: disabled || snap.xeroConnected
                                          ? null
                                          : (v) => setState(() => _xeroMode = v ?? 'read_only'),
                                    ),
                                    const Text('Read only'),
                                  ],
                                ),
                                if (snap.xeroConnected)
                                  TextButton(
                                    onPressed: disabled ? null : () => host.disconnectXero(revoke: true),
                                    child: Text('Revoke Xero access', style: TextStyle(color: lim.danger)),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      SizedBox(
                        width: _expandedId == 'slack' ? constraints.maxWidth : tileWidth.clamp(148, 280),
                        child: _IntegrationCard(
                          brandId: IntegrationBrandId.slack,
                          statusLine: snap.slackConnected
                              ? 'Ready · ${snap.slackAccountLabel}'
                              : integrationBrands[IntegrationBrandId.slack]!.tagline,
                          connected: snap.slackConnected,
                          expanded: _expandedId == 'slack',
                          onToggle: () => _toggleExpanded('slack'),
                          primaryLabel: snap.slackConnected ? 'Disconnect' : 'Connect',
                          primaryDanger: snap.slackConnected,
                          disabled: disabled,
                          onPrimary: () => unawaited(_slackPrimary(host, snap)),
                          child: Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Sign in with Slack so your agent can read channels and post updates.',
                                  style: TextStyle(color: lim.textMuted, fontSize: 12, height: 1.4),
                                ),
                                const SizedBox(height: 8),
                                Row(
                                  children: [
                                    Radio<String>(
                                      value: 'read_write',
                                      groupValue: _slackMode,
                                      onChanged: disabled || snap.slackConnected
                                          ? null
                                          : (v) => setState(() => _slackMode = v ?? 'read_write'),
                                    ),
                                    const Text('Read + write'),
                                    const SizedBox(width: 12),
                                    Radio<String>(
                                      value: 'read_only',
                                      groupValue: _slackMode,
                                      onChanged: disabled || snap.slackConnected
                                          ? null
                                          : (v) => setState(() => _slackMode = v ?? 'read_only'),
                                    ),
                                    const Text('Read only'),
                                  ],
                                ),
                                if (snap.slackConnected)
                                  TextButton(
                                    onPressed: disabled ? null : () => host.disconnectSlack(revoke: true),
                                    child: Text('Revoke Slack access', style: TextStyle(color: lim.danger)),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      SizedBox(
                        width: _expandedId == 'linear' ? constraints.maxWidth : tileWidth.clamp(148, 280),
                        child: _IntegrationCard(
                          brandId: IntegrationBrandId.linear,
                          statusLine: snap.linearConnected
                              ? 'Ready · ${snap.linearAccountLabel}'
                              : integrationBrands[IntegrationBrandId.linear]!.tagline,
                          connected: snap.linearConnected,
                          expanded: _expandedId == 'linear',
                          onToggle: () => _toggleExpanded('linear'),
                          primaryLabel: snap.linearConnected ? 'Disconnect' : 'Connect',
                          primaryDanger: snap.linearConnected,
                          disabled: disabled,
                          onPrimary: () => unawaited(_linearPrimary(host, snap)),
                          child: Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Sign in with Linear so your agent can list issues and create tickets.',
                                  style: TextStyle(color: lim.textMuted, fontSize: 12, height: 1.4),
                                ),
                                const SizedBox(height: 8),
                                Row(
                                  children: [
                                    Radio<String>(
                                      value: 'read_write',
                                      groupValue: _linearMode,
                                      onChanged: disabled || snap.linearConnected
                                          ? null
                                          : (v) => setState(() => _linearMode = v ?? 'read_write'),
                                    ),
                                    const Text('Read + write'),
                                    const SizedBox(width: 12),
                                    Radio<String>(
                                      value: 'read_only',
                                      groupValue: _linearMode,
                                      onChanged: disabled || snap.linearConnected
                                          ? null
                                          : (v) => setState(() => _linearMode = v ?? 'read_only'),
                                    ),
                                    const Text('Read only'),
                                  ],
                                ),
                                if (snap.linearConnected)
                                  TextButton(
                                    onPressed: disabled ? null : () => host.disconnectLinear(revoke: true),
                                    child: Text('Revoke Linear access', style: TextStyle(color: lim.danger)),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      SizedBox(
                        width: _expandedId == 'notion' ? constraints.maxWidth : tileWidth.clamp(148, 280),
                        child: _IntegrationCard(
                          brandId: IntegrationBrandId.notion,
                          statusLine: snap.notionConnected
                              ? 'Ready · ${snap.notionAccountLabel}'
                              : integrationBrands[IntegrationBrandId.notion]!.tagline,
                          connected: snap.notionConnected,
                          expanded: _expandedId == 'notion',
                          onToggle: () => _toggleExpanded('notion'),
                          primaryLabel: snap.notionConnected ? 'Disconnect' : 'Connect',
                          primaryDanger: snap.notionConnected,
                          disabled: disabled,
                          onPrimary: () => unawaited(_notionPrimary(host, snap)),
                          child: Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Radio<String>(
                                      value: 'read_write',
                                      groupValue: _notionMode,
                                      onChanged: disabled || snap.notionConnected
                                          ? null
                                          : (v) => setState(() => _notionMode = v ?? 'read_write'),
                                    ),
                                    const Text('Read + write'),
                                    const SizedBox(width: 12),
                                    Radio<String>(
                                      value: 'read_only',
                                      groupValue: _notionMode,
                                      onChanged: disabled || snap.notionConnected
                                          ? null
                                          : (v) => setState(() => _notionMode = v ?? 'read_only'),
                                    ),
                                    const Text('Read only'),
                                  ],
                                ),
                                if (snap.notionConnected)
                                  TextButton(
                                    onPressed: disabled ? null : () => host.disconnectNotion(revoke: true),
                                    child: Text('Revoke Notion access', style: TextStyle(color: lim.danger)),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      SizedBox(
                        width: _expandedId == 'github' ? constraints.maxWidth : tileWidth.clamp(148, 280),
                        child: _IntegrationCard(
                          brandId: IntegrationBrandId.github,
                          statusLine: snap.githubConnected
                              ? 'Ready · ${snap.githubToolCount} tools'
                              : snap.github.accounts.isNotEmpty
                                  ? 'Signed in — tap Enable tools'
                                  : integrationBrands[IntegrationBrandId.github]!.tagline,
                          connected: snap.githubConnected,
                          expanded: _expandedId == 'github',
                          onToggle: () => _toggleExpanded('github'),
                          primaryLabel: snap.githubConnected
                              ? 'Disconnect'
                              : snap.github.accounts.isNotEmpty
                                  ? 'Enable tools'
                                  : 'Connect',
                          primaryDanger: snap.githubConnected,
                          disabled: disabled,
                          onPrimary: () => _githubPrimary(host, snap),
                          child: Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Sign in with GitHub — your agent can work with repos and pull requests.',
                                  style: TextStyle(color: lim.textMuted, fontSize: 12, height: 1.4),
                                ),
                                if (snap.github.accounts.isNotEmpty) ...[
                                  const SizedBox(height: 8),
                                  for (final a in snap.github.accounts)
                                    Text(
                                      '${a.login ?? a.email ?? a.accountId} — ${a.scopes.length} scopes',
                                      style: TextStyle(
                                        color: lim.success,
                                        fontSize: 12,
                                        fontFamily: 'monospace',
                                      ),
                                    ),
                                ],
                                const SizedBox(height: 8),
                                Row(
                                  children: [
                                    Radio<String>(
                                      value: 'read_write',
                                      groupValue: _githubMode,
                                      onChanged: disabled || snap.githubConnected
                                          ? null
                                          : (v) => setState(() => _githubMode = v ?? 'read_write'),
                                    ),
                                    const Text('Read + write'),
                                    const SizedBox(width: 12),
                                    Radio<String>(
                                      value: 'read_only',
                                      groupValue: _githubMode,
                                      onChanged: disabled || snap.githubConnected
                                          ? null
                                          : (v) => setState(() => _githubMode = v ?? 'read_only'),
                                    ),
                                    const Text('Read only'),
                                  ],
                                ),
                                if (snap.githubConnected || snap.github.accounts.isNotEmpty)
                                  TextButton(
                                    onPressed: disabled || snap.github.accounts.isEmpty
                                        ? null
                                        : () => host.disconnectGithub(revoke: true),
                                    child: Text('Revoke GitHub access', style: TextStyle(color: lim.danger)),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      SizedBox(
                        width: _expandedId == 'advanced' ? constraints.maxWidth : tileWidth.clamp(148, 280),
                        child: _IntegrationCard(
                          brandId: IntegrationBrandId.advanced,
                          statusLine: snap.customMcp.isNotEmpty || snap.openApi.isNotEmpty
                              ? '${snap.customMcp.length + snap.openApi.length} custom connections'
                              : integrationBrands[IntegrationBrandId.advanced]!.tagline,
                          connected: snap.customMcp.isNotEmpty || snap.openApi.isNotEmpty,
                          expanded: _expandedId == 'advanced',
                          onToggle: () => _toggleExpanded('advanced'),
                          showPrimary: false,
                          primaryLabel: '',
                          disabled: disabled,
                          onPrimary: () {},
                          child: _AdvancedSection(
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
                      ),
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
}

class _IntegrationCard extends StatelessWidget {
  const _IntegrationCard({
    required this.brandId,
    required this.statusLine,
    required this.connected,
    required this.expanded,
    required this.onToggle,
    required this.primaryLabel,
    required this.onPrimary,
    required this.disabled,
    this.primaryDanger = false,
    this.showPrimary = true,
    this.child,
  });

  final IntegrationBrandId brandId;
  final String statusLine;
  final bool connected;
  final bool expanded;
  final VoidCallback onToggle;
  final String primaryLabel;
  final VoidCallback onPrimary;
  final bool disabled;
  final bool primaryDanger;
  final bool showPrimary;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final brand = integrationBrands[brandId]!;
    final statusColor = connected ? lim.success : lim.warn;

    return Material(
      color: connected ? lim.success.withValues(alpha: 0.05) : lim.surface.withValues(alpha: 0.5),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(
          color: connected ? lim.success.withValues(alpha: 0.35) : lim.accent.withValues(alpha: 0.14),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: onToggle,
            borderRadius: BorderRadius.circular(10),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 14, 12, 12),
              child: Column(
                children: [
                  IntegrationBrandIcon(id: brandId, size: 52),
                  const SizedBox(height: 10),
                  Text(
                    brand.title,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    statusLine,
                    textAlign: TextAlign.center,
                    style: TextStyle(color: lim.textMuted, fontSize: 12, height: 1.35),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      border: Border.all(color: statusColor.withValues(alpha: 0.6)),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      connected ? 'Connected' : 'Not connected',
                      style: TextStyle(color: statusColor, fontSize: 10),
                    ),
                  ),
                  if (showPrimary) ...[
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: disabled ? null : onPrimary,
                        style: primaryDanger
                            ? FilledButton.styleFrom(backgroundColor: lim.danger.withValues(alpha: 0.85))
                            : null,
                        child: Text(primaryLabel),
                      ),
                    ),
                  ] else ...[
                    const SizedBox(height: 8),
                    Text('Tap for options', style: TextStyle(color: lim.textDim, fontSize: 11)),
                  ],
                  const SizedBox(height: 6),
                  Text(
                    expanded ? 'Hide options' : 'More options',
                    style: TextStyle(color: lim.textDim, fontSize: 10),
                  ),
                ],
              ),
            ),
          ),
          if (expanded && child != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: child!,
            ),
        ],
      ),
    );
  }
}

class _GoogleDetails extends StatelessWidget {
  const _GoogleDetails({
    required this.snap,
    required this.disabled,
    required this.mode,
    required this.services,
    required this.selected,
    required this.onMode,
    required this.onToggleService,
    required this.onReattach,
    required this.onAttachCalendar,
    required this.onRevoke,
  });

  final IntegrationsSnapshot snap;
  final bool disabled;
  final String mode;
  final List<String> services;
  final Set<String> selected;
  final ValueChanged<String> onMode;
  final ValueChanged<String> onToggleService;
  final Future<bool> Function() onReattach;
  final Future<bool> Function() onAttachCalendar;
  final Future<bool> Function() onRevoke;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Sign in with Google, then enable MCP tools for the agent.',
          style: TextStyle(color: lim.textMuted, fontSize: 12, height: 1.4),
        ),
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
        if (services.isNotEmpty) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final s in services)
                FilterChip(
                  label: Text(s),
                  selected: selected.contains(s),
                  onSelected: disabled ? null : (_) => onToggleService(s),
                ),
            ],
          ),
        ],
        const SizedBox(height: 8),
        if (snap.google.accounts.isNotEmpty &&
            !snap.googleCalendarAttached) ...[
          const SizedBox(height: 4),
          Text(
            'Gmail may work while Calendar MCP is not attached — enable Calendar separately.',
            style: TextStyle(color: lim.warn.withValues(alpha: 0.9), fontSize: 11, height: 1.35),
          ),
        ],
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (snap.google.accounts.isNotEmpty && !snap.googleCalendarAttached)
              FilledButton.tonal(
                onPressed: disabled ? null : () => onAttachCalendar(),
                child: const Text('Attach Calendar'),
              ),
            OutlinedButton(
              onPressed: disabled || snap.google.accounts.isEmpty ? null : () => onReattach(),
              child: const Text('Re-attach tools'),
            ),
            TextButton(
              onPressed: disabled || snap.google.accounts.isEmpty ? null : () => onRevoke(),
              style: TextButton.styleFrom(foregroundColor: lim.danger.withValues(alpha: 0.85)),
              child: const Text('Revoke Google access'),
            ),
          ],
        ),
      ],
    );
  }
}

class _MicrosoftDetails extends StatelessWidget {
  const _MicrosoftDetails({
    required this.snap,
    required this.disabled,
    required this.mode,
    required this.services,
    required this.selected,
    required this.onMode,
    required this.onToggleService,
    required this.onReattach,
    required this.onRevoke,
  });

  final IntegrationsSnapshot snap;
  final bool disabled;
  final String mode;
  final List<String> services;
  final Set<String> selected;
  final ValueChanged<String> onMode;
  final ValueChanged<String> onToggleService;
  final Future<bool> Function() onReattach;
  final Future<bool> Function() onRevoke;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Opens Vireon-hosted Microsoft sign-in, then attaches Graph MCP tools (ms-365-mcp-server sidecar).',
          style: TextStyle(color: lim.textMuted, fontSize: 12, height: 1.4),
        ),
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
        if (services.isNotEmpty) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final s in services)
                FilterChip(
                  label: Text(s),
                  selected: selected.contains(s),
                  onSelected: disabled ? null : (_) => onToggleService(s),
                ),
            ],
          ),
        ],
        if (snap.microsoft.sidecar.url.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(
            'Sidecar: ${snap.microsoft.sidecar.running ? snap.microsoft.sidecar.url : "stopped"}',
            style: TextStyle(
              color: snap.microsoft.sidecar.running ? lim.success : lim.warn,
              fontSize: 11,
              fontFamily: 'monospace',
            ),
          ),
        ],
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: [
            OutlinedButton(
              onPressed: disabled || snap.microsoft.accounts.isEmpty ? null : () => onReattach(),
              child: const Text('Re-attach tools'),
            ),
            TextButton(
              onPressed: disabled || snap.microsoft.accounts.isEmpty ? null : () => onRevoke(),
              style: TextButton.styleFrom(foregroundColor: lim.danger.withValues(alpha: 0.85)),
              child: const Text('Revoke Microsoft access'),
            ),
          ],
        ),
      ],
    );
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

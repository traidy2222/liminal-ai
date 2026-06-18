import '../../models/integrations_snapshot.dart';
import 'integration_brand_icon.dart';
import 'integration_connection_status.dart';

/// Copy + action labels for one integration row (collapsed).
class IntegrationProviderPresentation {
  const IntegrationProviderPresentation({
    required this.nextStep,
    required this.actionLabel,
    this.actionDanger = false,
    this.showAction = true,
    this.ready = false,
    this.statusMode = IntegrationStatusMode.simple,
    this.signedIn,
    this.toolsAttached,
    this.highlight = false,
  });

  final String nextStep;
  final String actionLabel;
  final bool actionDanger;
  final bool showAction;
  final bool ready;
  final IntegrationStatusMode statusMode;
  final bool? signedIn;
  final bool? toolsAttached;
  final bool highlight;
}

IntegrationProviderPresentation integrationPresentation({
  required IntegrationBrandId brandId,
  required IntegrationsSnapshot snap,
  bool busy = false,
  bool xeroFullScopes = false,
  bool xeroExtended = false,
}) {
  switch (brandId) {
    case IntegrationBrandId.google:
      if (snap.googleConnected) {
        final n = snap.google.accounts.length;
        return IntegrationProviderPresentation(
          nextStep: n > 1
              ? '$n accounts · ${snap.googleToolCount} agent tools'
              : '${snap.googleToolCount} agent tools active',
          actionLabel: 'Add account',
          ready: true,
          highlight: true,
          statusMode: IntegrationStatusMode.oauthMcp,
          signedIn: true,
          toolsAttached: true,
        );
      }
      if (snap.googleSignedIn) {
        return IntegrationProviderPresentation(
          nextStep: busy ? 'Finishing sign-in…' : 'Step 2 — enable tools for your agent',
          actionLabel: 'Enable tools',
          statusMode: IntegrationStatusMode.oauthMcp,
          signedIn: true,
          toolsAttached: false,
        );
      }
      return const IntegrationProviderPresentation(
        nextStep: 'Step 1 — sign in with Google',
        actionLabel: 'Sign in',
        statusMode: IntegrationStatusMode.oauthMcp,
        signedIn: false,
        toolsAttached: false,
      );

    case IntegrationBrandId.microsoft:
      if (snap.microsoftConnected) {
        final n = snap.microsoft.accounts.length;
        return IntegrationProviderPresentation(
          nextStep: n > 1
              ? '$n accounts · ${snap.microsoftToolCount} agent tools'
              : '${snap.microsoftToolCount} agent tools active',
          actionLabel: 'Add account',
          ready: true,
          highlight: true,
          statusMode: IntegrationStatusMode.oauthMcp,
          signedIn: true,
          toolsAttached: true,
        );
      }
      if (snap.microsoftSignedIn) {
        return IntegrationProviderPresentation(
          nextStep: 'Step 2 — enable Microsoft tools',
          actionLabel: 'Enable tools',
          statusMode: IntegrationStatusMode.oauthMcp,
          signedIn: true,
          toolsAttached: false,
        );
      }
      return const IntegrationProviderPresentation(
        nextStep: 'Step 1 — sign in with Microsoft',
        actionLabel: 'Sign in',
        statusMode: IntegrationStatusMode.oauthMcp,
        signedIn: false,
        toolsAttached: false,
      );

    case IntegrationBrandId.azure:
      if (snap.azureToolsAttached) {
        final n = snap.azure.accounts.length;
        return IntegrationProviderPresentation(
          nextStep: n > 1
              ? '$n accounts · ${snap.azureToolCount} MCP tools'
              : '${snap.azureToolCount} MCP tools active',
          actionLabel: 'Add account',
          ready: true,
          highlight: true,
          statusMode: IntegrationStatusMode.oauthMcp,
          signedIn: true,
          toolsAttached: true,
        );
      }
      if (snap.azureSignedIn) {
        return IntegrationProviderPresentation(
          nextStep: 'Step 2 — attach Azure MCP tools',
          actionLabel: 'Enable tools',
          statusMode: IntegrationStatusMode.oauthMcp,
          signedIn: true,
          toolsAttached: false,
        );
      }
      return const IntegrationProviderPresentation(
        nextStep: 'Step 1 — sign in with Azure',
        actionLabel: 'Sign in',
        statusMode: IntegrationStatusMode.oauthMcp,
        signedIn: false,
        toolsAttached: false,
      );

    case IntegrationBrandId.github:
      if (snap.githubConnected) {
        final n = snap.github.accounts.length;
        return IntegrationProviderPresentation(
          nextStep: n > 1
              ? '$n accounts · ${snap.githubToolCount} agent tools'
              : '${snap.githubToolCount} agent tools active',
          actionLabel: 'Add account',
          ready: true,
          highlight: true,
          statusMode: IntegrationStatusMode.oauthMcp,
          signedIn: true,
          toolsAttached: true,
        );
      }
      if (snap.githubSignedIn) {
        return IntegrationProviderPresentation(
          nextStep: 'Step 2 — enable GitHub tools',
          actionLabel: 'Enable tools',
          statusMode: IntegrationStatusMode.oauthMcp,
          signedIn: true,
          toolsAttached: false,
        );
      }
      return const IntegrationProviderPresentation(
        nextStep: 'Step 1 — sign in with GitHub',
        actionLabel: 'Sign in',
        statusMode: IntegrationStatusMode.oauthMcp,
        signedIn: false,
        toolsAttached: false,
      );

    case IntegrationBrandId.xero:
      final needsReconnect = snap.xeroNeedsReconnect ||
          (xeroFullScopes && snap.xeroNeedsFullReconnect) ||
          (xeroExtended && snap.xeroNeedsExtendedReconnect);
      if (snap.xeroConnected && !needsReconnect) {
        final n = snap.xero.accounts.length;
        return IntegrationProviderPresentation(
          nextStep: n > 1 ? '$n orgs connected' : 'Ready · ${snap.xeroAccountLabel}',
          actionLabel: 'Add account',
          ready: true,
          highlight: true,
          statusMode: IntegrationStatusMode.oauthAutoAttach,
          signedIn: true,
        );
      }
      if (snap.xeroConnected && needsReconnect) {
        return IntegrationProviderPresentation(
          nextStep: 'Scopes changed — reconnect to finish setup',
          actionLabel: 'Reconnect',
          statusMode: IntegrationStatusMode.oauthAutoAttach,
          signedIn: true,
        );
      }
      return const IntegrationProviderPresentation(
        nextStep: 'One step — sign in; tools attach automatically',
        actionLabel: 'Sign in',
        statusMode: IntegrationStatusMode.oauthAutoAttach,
        signedIn: false,
      );

    case IntegrationBrandId.slack:
      if (snap.slackConnected) {
        final n = snap.slack.accounts.length;
        return IntegrationProviderPresentation(
          nextStep: n > 1 ? '$n workspaces connected' : 'Ready · ${snap.slackAccountLabel}',
          actionLabel: 'Add account',
          ready: true,
          highlight: true,
          statusMode: IntegrationStatusMode.oauthAutoAttach,
          signedIn: true,
        );
      }
      return const IntegrationProviderPresentation(
        nextStep: 'One step — sign in; tools attach automatically',
        actionLabel: 'Sign in',
        statusMode: IntegrationStatusMode.oauthAutoAttach,
        signedIn: false,
      );

    case IntegrationBrandId.linear:
      if (snap.linearConnected) {
        final n = snap.linear.accounts.length;
        return IntegrationProviderPresentation(
          nextStep: n > 1 ? '$n orgs connected' : 'Ready · ${snap.linearAccountLabel}',
          actionLabel: 'Add account',
          ready: true,
          highlight: true,
          statusMode: IntegrationStatusMode.oauthAutoAttach,
          signedIn: true,
        );
      }
      return const IntegrationProviderPresentation(
        nextStep: 'One step — sign in; tools attach automatically',
        actionLabel: 'Sign in',
        statusMode: IntegrationStatusMode.oauthAutoAttach,
        signedIn: false,
      );

    case IntegrationBrandId.notion:
      if (snap.notionConnected) {
        final n = snap.notion.accounts.length;
        return IntegrationProviderPresentation(
          nextStep: n > 1 ? '$n workspaces connected' : 'Ready · ${snap.notionAccountLabel}',
          actionLabel: 'Add account',
          ready: true,
          highlight: true,
          statusMode: IntegrationStatusMode.oauthAutoAttach,
          signedIn: true,
        );
      }
      return const IntegrationProviderPresentation(
        nextStep: 'One step — sign in; tools attach automatically',
        actionLabel: 'Sign in',
        statusMode: IntegrationStatusMode.oauthAutoAttach,
        signedIn: false,
      );

    case IntegrationBrandId.youtube:
      if (snap.youtubeConnected) {
        final n = snap.youtube.accounts.length;
        return IntegrationProviderPresentation(
          nextStep: n > 1 ? '$n channels connected' : 'Ready · ${snap.youtubeAccountLabel}',
          actionLabel: 'Add account',
          ready: true,
          highlight: true,
          statusMode: IntegrationStatusMode.oauthAutoAttach,
          signedIn: true,
        );
      }
      return const IntegrationProviderPresentation(
        nextStep: 'Connect your YouTube channel (separate from Google Workspace)',
        actionLabel: 'Sign in',
        statusMode: IntegrationStatusMode.oauthAutoAttach,
        signedIn: false,
      );

    case IntegrationBrandId.advanced:
      final count = snap.customMcp.length + snap.openApi.length;
      return IntegrationProviderPresentation(
        nextStep: count > 0 ? '$count custom connection${count == 1 ? '' : 's'}' : 'Add MCP servers or OpenAPI specs',
        actionLabel: 'Manage',
        showAction: false,
        ready: count > 0,
        highlight: count > 0,
        statusMode: IntegrationStatusMode.simple,
        signedIn: count > 0,
      );
  }
}

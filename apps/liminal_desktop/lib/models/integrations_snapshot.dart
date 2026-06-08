class IntegrationsSnapshot {
  IntegrationsSnapshot({
    required this.google,
    required this.microsoft,
    required this.github,
    required this.xero,
    required this.slack,
    required this.linear,
    required this.notion,
    required this.connections,
  });

  final GoogleIntegrations google;
  final MicrosoftIntegrations microsoft;
  final GithubIntegrations github;
  final XeroIntegrations xero;
  final SlackIntegrations slack;
  final LinearIntegrations linear;
  final NotionIntegrations notion;
  final List<IntegrationConnection> connections;

  factory IntegrationsSnapshot.fromJson(Map<String, dynamic> json) {
    return IntegrationsSnapshot(
      google: GoogleIntegrations.fromJson(
        Map<String, dynamic>.from(json['google'] as Map? ?? {}),
      ),
      microsoft: MicrosoftIntegrations.fromJson(
        Map<String, dynamic>.from(json['microsoft'] as Map? ?? {}),
      ),
      github: GithubIntegrations.fromJson(
        Map<String, dynamic>.from(json['github'] as Map? ?? {}),
      ),
      xero: XeroIntegrations.fromJson(
        Map<String, dynamic>.from(json['xero'] as Map? ?? {}),
      ),
      slack: SlackIntegrations.fromJson(
        Map<String, dynamic>.from(json['slack'] as Map? ?? {}),
      ),
      linear: LinearIntegrations.fromJson(
        Map<String, dynamic>.from(json['linear'] as Map? ?? {}),
      ),
      notion: NotionIntegrations.fromJson(
        Map<String, dynamic>.from(json['notion'] as Map? ?? {}),
      ),
      connections: (json['connections'] as List<dynamic>? ?? [])
          .map(
            (e) => IntegrationConnection.fromJson(
              Map<String, dynamic>.from(e as Map),
            ),
          )
          .toList(),
    );
  }

  static final empty = IntegrationsSnapshot(
    google: GoogleIntegrations.empty,
    microsoft: MicrosoftIntegrations.empty,
    github: GithubIntegrations.empty,
    xero: XeroIntegrations.empty,
    slack: SlackIntegrations.empty,
    linear: LinearIntegrations.empty,
    notion: NotionIntegrations.empty,
    connections: [],
  );

  static const _curatedParents = {'google_workspace', 'microsoft_365', 'github'};

  List<IntegrationConnection> get customMcp => connections
      .where(
        (c) =>
            c.kind == 'mcp' &&
            (c.parentProvider == null || !_curatedParents.contains(c.parentProvider)),
      )
      .toList();

  List<IntegrationConnection> get googleMcp => connections
      .where((c) => c.kind == 'mcp' && c.parentProvider == 'google_workspace')
      .toList();

  List<IntegrationConnection> get githubMcp => connections
      .where((c) => c.kind == 'mcp' && c.parentProvider == 'github')
      .toList();

  List<IntegrationConnection> get microsoftMcp => connections
      .where((c) => c.kind == 'mcp' && c.parentProvider == 'microsoft_365')
      .toList();

  List<IntegrationConnection> get openApi =>
      connections.where((c) => c.kind == 'openapi').toList();

  bool get googleConnected => googleMcp.isNotEmpty;

  bool get microsoftConnected => microsoftMcp.isNotEmpty;

  bool get githubConnected => githubMcp.isNotEmpty;

  bool get xeroConnected => xero.accounts.isNotEmpty;

  bool get slackConnected => slack.accounts.isNotEmpty;

  bool get linearConnected => linear.accounts.isNotEmpty;

  bool get notionConnected => notion.accounts.isNotEmpty;

  int get googleToolCount => googleMcp.fold(0, (n, c) => n + c.toolCount);

  int get microsoftToolCount => microsoftMcp.fold(0, (n, c) => n + c.toolCount);

  int get githubToolCount => githubMcp.fold(0, (n, c) => n + c.toolCount);

  String get googleAccountLabel {
    if (google.accounts.isEmpty) return 'Google';
    return google.accounts.first.email ?? 'Google';
  }

  String get microsoftAccountLabel {
    if (microsoft.accounts.isEmpty) return 'Microsoft 365';
    return microsoft.accounts.first.email ?? 'Microsoft 365';
  }

  String get xeroAccountLabel {
    if (xero.accounts.isEmpty) return 'Xero';
    final a = xero.accounts.first;
    final tenant = a.tenantName ?? a.tenantId;
    final base = a.email ?? 'Xero';
    return tenant != null ? '$base · $tenant' : base;
  }

  String get githubAccountLabel {
    if (github.accounts.isEmpty) return 'GitHub';
    final a = github.accounts.first;
    return a.login ?? a.email ?? a.accountId;
  }

  String get slackAccountLabel {
    if (slack.accounts.isEmpty) return 'Slack';
    final a = slack.accounts.first;
    return a.teamName ?? a.email ?? a.accountId;
  }

  String get linearAccountLabel {
    if (linear.accounts.isEmpty) return 'Linear';
    final a = linear.accounts.first;
    return a.organizationName ?? a.email ?? a.accountId;
  }

  String get notionAccountLabel {
    if (notion.accounts.isEmpty) return 'Notion';
    final a = notion.accounts.first;
    return a.workspaceName ?? a.email ?? a.accountId;
  }

}

class MicrosoftIntegrations {
  MicrosoftIntegrations({
    required this.accounts,
    required this.sidecar,
    required this.services,
  });

  final List<MicrosoftOAuthAccount> accounts;
  final MicrosoftSidecarStatus sidecar;
  final List<String> services;

  factory MicrosoftIntegrations.fromJson(Map<String, dynamic> json) {
    return MicrosoftIntegrations(
      accounts: (json['accounts'] as List<dynamic>? ?? [])
          .map(
            (e) => MicrosoftOAuthAccount.fromJson(
              Map<String, dynamic>.from(e as Map),
            ),
          )
          .toList(),
      sidecar: MicrosoftSidecarStatus.fromJson(
        Map<String, dynamic>.from(json['sidecar'] as Map? ?? {}),
      ),
      services: (json['services'] as List<dynamic>? ?? [])
          .map((e) => e.toString())
          .toList(),
    );
  }

  static final empty = MicrosoftIntegrations(
    accounts: [],
    sidecar: MicrosoftSidecarStatus.empty,
    services: [],
  );
}

class MicrosoftOAuthAccount {
  MicrosoftOAuthAccount({
    required this.accountId,
    this.email,
    required this.scopes,
    this.missingScopes = const [],
  });

  final String accountId;
  final String? email;
  final List<String> scopes;
  final List<String> missingScopes;

  factory MicrosoftOAuthAccount.fromJson(Map<String, dynamic> json) {
    return MicrosoftOAuthAccount(
      accountId: json['accountId'] as String? ?? '',
      email: json['email'] as String?,
      scopes: (json['scopes'] as List<dynamic>? ?? []).map((e) => e.toString()).toList(),
      missingScopes: (json['missingScopes'] as List<dynamic>? ?? [])
          .map((e) => e.toString())
          .toList(),
    );
  }
}

class MicrosoftSidecarStatus {
  MicrosoftSidecarStatus({
    required this.enabled,
    required this.running,
    required this.port,
    required this.url,
  });

  final bool enabled;
  final bool running;
  final int port;
  final String url;

  factory MicrosoftSidecarStatus.fromJson(Map<String, dynamic> json) {
    return MicrosoftSidecarStatus(
      enabled: json['enabled'] as bool? ?? false,
      running: json['running'] as bool? ?? false,
      port: (json['port'] as num?)?.toInt() ?? 0,
      url: json['url'] as String? ?? '',
    );
  }

  static final empty = MicrosoftSidecarStatus(
    enabled: false,
    running: false,
    port: 0,
    url: '',
  );
}

class GithubIntegrations {
  GithubIntegrations({required this.accounts});

  final List<GithubOAuthAccount> accounts;

  factory GithubIntegrations.fromJson(Map<String, dynamic> json) {
    return GithubIntegrations(
      accounts: (json['accounts'] as List<dynamic>? ?? [])
          .map(
            (e) => GithubOAuthAccount.fromJson(
              Map<String, dynamic>.from(e as Map),
            ),
          )
          .toList(),
    );
  }

  static final empty = GithubIntegrations(accounts: []);
}

class GithubOAuthAccount {
  GithubOAuthAccount({
    required this.accountId,
    this.email,
    this.login,
    required this.scopes,
  });

  final String accountId;
  final String? email;
  final String? login;
  final List<String> scopes;

  factory GithubOAuthAccount.fromJson(Map<String, dynamic> json) {
    return GithubOAuthAccount(
      accountId: json['accountId'] as String? ?? '',
      email: json['email'] as String?,
      login: json['login'] as String?,
      scopes: (json['scopes'] as List<dynamic>? ?? []).map((e) => e.toString()).toList(),
    );
  }
}

class XeroIntegrations {
  XeroIntegrations({required this.accounts});

  final List<XeroOAuthAccount> accounts;

  factory XeroIntegrations.fromJson(Map<String, dynamic> json) {
    return XeroIntegrations(
      accounts: (json['accounts'] as List<dynamic>? ?? [])
          .map(
            (e) => XeroOAuthAccount.fromJson(
              Map<String, dynamic>.from(e as Map),
            ),
          )
          .toList(),
    );
  }

  static final empty = XeroIntegrations(accounts: []);
}

class XeroOAuthAccount {
  XeroOAuthAccount({
    required this.accountId,
    this.email,
    required this.scopes,
    this.tenantId,
    this.tenantName,
  });

  final String accountId;
  final String? email;
  final List<String> scopes;
  final String? tenantId;
  final String? tenantName;

  factory XeroOAuthAccount.fromJson(Map<String, dynamic> json) {
    return XeroOAuthAccount(
      accountId: json['accountId'] as String? ?? '',
      email: json['email'] as String?,
      scopes: (json['scopes'] as List<dynamic>? ?? []).map((e) => e.toString()).toList(),
      tenantId: json['tenantId'] as String?,
      tenantName: json['tenantName'] as String?,
    );
  }
}

class SlackIntegrations {
  SlackIntegrations({required this.accounts});

  final List<SlackOAuthAccount> accounts;

  factory SlackIntegrations.fromJson(Map<String, dynamic> json) {
    return SlackIntegrations(
      accounts: (json['accounts'] as List<dynamic>? ?? [])
          .map((e) => SlackOAuthAccount.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(),
    );
  }

  static final empty = SlackIntegrations(accounts: []);
}

class SlackOAuthAccount {
  SlackOAuthAccount({
    required this.accountId,
    this.email,
    required this.scopes,
    this.teamId,
    this.teamName,
  });

  final String accountId;
  final String? email;
  final List<String> scopes;
  final String? teamId;
  final String? teamName;

  factory SlackOAuthAccount.fromJson(Map<String, dynamic> json) {
    return SlackOAuthAccount(
      accountId: json['accountId'] as String? ?? '',
      email: json['email'] as String?,
      scopes: (json['scopes'] as List<dynamic>? ?? []).map((e) => e.toString()).toList(),
      teamId: json['teamId'] as String?,
      teamName: json['teamName'] as String?,
    );
  }
}

class LinearIntegrations {
  LinearIntegrations({required this.accounts});

  final List<LinearOAuthAccount> accounts;

  factory LinearIntegrations.fromJson(Map<String, dynamic> json) {
    return LinearIntegrations(
      accounts: (json['accounts'] as List<dynamic>? ?? [])
          .map((e) => LinearOAuthAccount.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(),
    );
  }

  static final empty = LinearIntegrations(accounts: []);
}

class LinearOAuthAccount {
  LinearOAuthAccount({
    required this.accountId,
    this.email,
    required this.scopes,
    this.organizationName,
  });

  final String accountId;
  final String? email;
  final List<String> scopes;
  final String? organizationName;

  factory LinearOAuthAccount.fromJson(Map<String, dynamic> json) {
    return LinearOAuthAccount(
      accountId: json['accountId'] as String? ?? '',
      email: json['email'] as String?,
      scopes: (json['scopes'] as List<dynamic>? ?? []).map((e) => e.toString()).toList(),
      organizationName: json['organizationName'] as String?,
    );
  }
}

class NotionIntegrations {
  NotionIntegrations({required this.accounts});

  final List<NotionOAuthAccount> accounts;

  factory NotionIntegrations.fromJson(Map<String, dynamic> json) {
    return NotionIntegrations(
      accounts: (json['accounts'] as List<dynamic>? ?? [])
          .map((e) => NotionOAuthAccount.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(),
    );
  }

  static final empty = NotionIntegrations(accounts: []);
}

class NotionOAuthAccount {
  NotionOAuthAccount({
    required this.accountId,
    this.email,
    required this.scopes,
    this.workspaceId,
    this.workspaceName,
  });

  final String accountId;
  final String? email;
  final List<String> scopes;
  final String? workspaceId;
  final String? workspaceName;

  factory NotionOAuthAccount.fromJson(Map<String, dynamic> json) {
    return NotionOAuthAccount(
      accountId: json['accountId'] as String? ?? '',
      email: json['email'] as String?,
      scopes: (json['scopes'] as List<dynamic>? ?? []).map((e) => e.toString()).toList(),
      workspaceId: json['workspaceId'] as String?,
      workspaceName: json['workspaceName'] as String?,
    );
  }
}

class GoogleIntegrations {
  GoogleIntegrations({
    required this.accounts,
    required this.sidecar,
    required this.services,
  });

  final List<GoogleOAuthAccount> accounts;
  final GoogleSidecarStatus sidecar;
  final List<String> services;

  factory GoogleIntegrations.fromJson(Map<String, dynamic> json) {
    return GoogleIntegrations(
      accounts: (json['accounts'] as List<dynamic>? ?? [])
          .map(
            (e) => GoogleOAuthAccount.fromJson(
              Map<String, dynamic>.from(e as Map),
            ),
          )
          .toList(),
      sidecar: GoogleSidecarStatus.fromJson(
        Map<String, dynamic>.from(json['sidecar'] as Map? ?? {}),
      ),
      services: (json['services'] as List<dynamic>? ?? [])
          .map((e) => e.toString())
          .toList(),
    );
  }

  static final empty = GoogleIntegrations(
    accounts: [],
    sidecar: GoogleSidecarStatus.empty,
    services: [],
  );
}

class GoogleOAuthAccount {
  GoogleOAuthAccount({
    required this.accountId,
    this.email,
    required this.scopes,
    this.missingScopes = const [],
  });

  final String accountId;
  final String? email;
  final List<String> scopes;
  final List<String> missingScopes;

  factory GoogleOAuthAccount.fromJson(Map<String, dynamic> json) {
    return GoogleOAuthAccount(
      accountId: json['accountId'] as String? ?? '',
      email: json['email'] as String?,
      scopes: (json['scopes'] as List<dynamic>? ?? []).map((e) => e.toString()).toList(),
      missingScopes: (json['missingScopes'] as List<dynamic>? ?? [])
          .map((e) => e.toString())
          .toList(),
    );
  }
}

class GoogleSidecarStatus {
  GoogleSidecarStatus({
    required this.enabled,
    required this.running,
    required this.port,
    required this.url,
  });

  final bool enabled;
  final bool running;
  final int port;
  final String url;

  factory GoogleSidecarStatus.fromJson(Map<String, dynamic> json) {
    return GoogleSidecarStatus(
      enabled: json['enabled'] as bool? ?? false,
      running: json['running'] as bool? ?? false,
      port: (json['port'] as num?)?.toInt() ?? 0,
      url: json['url'] as String? ?? '',
    );
  }

  static final empty = GoogleSidecarStatus(
    enabled: false,
    running: false,
    port: 0,
    url: '',
  );
}

class IntegrationConnection {
  IntegrationConnection({
    required this.kind,
    required this.name,
    required this.toolCount,
    required this.sampleTools,
    required this.authKind,
    required this.attachedAt,
    this.parentProvider,
    this.serverUrl,
    this.specUrl,
    this.baseUrl,
    this.readOnly,
    this.services,
  });

  final String kind;
  final String name;
  final int toolCount;
  final List<String> sampleTools;
  final String authKind;
  final int attachedAt;
  final String? parentProvider;
  final String? serverUrl;
  final String? specUrl;
  final String? baseUrl;
  final bool? readOnly;
  final List<String>? services;

  factory IntegrationConnection.fromJson(Map<String, dynamic> json) {
    return IntegrationConnection(
      kind: json['kind'] as String? ?? 'mcp',
      name: json['name'] as String? ?? '',
      toolCount: (json['toolCount'] as num?)?.toInt() ?? 0,
      sampleTools: (json['sampleTools'] as List<dynamic>? ?? [])
          .map((e) => e.toString())
          .toList(),
      authKind: json['authKind'] as String? ?? 'none',
      attachedAt: (json['attachedAt'] as num?)?.toInt() ?? 0,
      parentProvider: json['parentProvider'] as String?,
      serverUrl: json['serverUrl'] as String?,
      specUrl: json['specUrl'] as String?,
      baseUrl: json['baseUrl'] as String?,
      readOnly: json['readOnly'] as bool?,
      services: (json['services'] as List<dynamic>?)
          ?.map((e) => e.toString())
          .toList(),
    );
  }
}

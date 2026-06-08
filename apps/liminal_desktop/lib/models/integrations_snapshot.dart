class IntegrationsSnapshot {
  IntegrationsSnapshot({
    required this.google,
    required this.microsoft,
    required this.github,
    required this.xero,
    required this.connections,
  });

  final GoogleIntegrations google;
  final MicrosoftIntegrations microsoft;
  final GithubIntegrations github;
  final XeroIntegrations xero;
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

  int get googleToolCount => googleMcp.fold(0, (n, c) => n + c.toolCount);

  int get microsoftToolCount => microsoftMcp.fold(0, (n, c) => n + c.toolCount);

  int get githubToolCount => githubMcp.fold(0, (n, c) => n + c.toolCount);
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
  GithubIntegrations({
    required this.tokenConfigured,
    required this.mcpUrl,
  });

  final bool tokenConfigured;
  final String mcpUrl;

  factory GithubIntegrations.fromJson(Map<String, dynamic> json) {
    return GithubIntegrations(
      tokenConfigured: json['tokenConfigured'] as bool? ?? false,
      mcpUrl: json['mcpUrl'] as String? ?? '',
    );
  }

  static final empty = GithubIntegrations(tokenConfigured: false, mcpUrl: '');
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

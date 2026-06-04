class VireonAccountRecord {
  VireonAccountRecord({
    required this.email,
    required this.tier,
    this.licenseSub,
    this.connectedAt,
  });

  final String email;
  final String tier;
  final String? licenseSub;
  final int? connectedAt;

  factory VireonAccountRecord.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return VireonAccountRecord(email: '', tier: '');
    }
    return VireonAccountRecord(
      email: json['email'] as String? ?? '',
      tier: json['tier'] as String? ?? '',
      licenseSub: json['licenseSub'] as String?,
      connectedAt: (json['connectedAt'] as num?)?.toInt(),
    );
  }
}

class VireonAccountSnapshot {
  VireonAccountSnapshot({
    required this.connected,
    required this.tier,
    required this.licensed,
    required this.entitlements,
    this.account,
    this.orgId,
  });

  final bool connected;
  final VireonAccountRecord? account;
  final String tier;
  final bool licensed;
  final List<String> entitlements;
  final String? orgId;

  String? get email => account?.email;

  factory VireonAccountSnapshot.fromJson(Map<String, dynamic> json) {
    final accountRaw = json['account'];
    return VireonAccountSnapshot(
      connected: json['connected'] as bool? ?? false,
      account: accountRaw is Map
          ? VireonAccountRecord.fromJson(Map<String, dynamic>.from(accountRaw))
          : null,
      tier: json['tier'] as String? ?? 'community',
      licensed: json['licensed'] as bool? ?? false,
      entitlements: (json['entitlements'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          const [],
      orgId: json['orgId'] as String?,
    );
  }

  static final empty = VireonAccountSnapshot(
    connected: false,
    tier: 'community',
    licensed: false,
    entitlements: [],
  );
}

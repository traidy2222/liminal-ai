class ProcedureActivity {
  const ProcedureActivity({
    required this.action,
    required this.name,
    required this.reason,
    this.state,
    this.versionId,
    this.runId,
  });
  final String action;
  final String name;
  final String reason;
  final String? state;
  final String? versionId;
  final String? runId;
  factory ProcedureActivity.fromJson(Map<String, dynamic> value) =>
      ProcedureActivity(
        action: value['action'] as String? ?? 'error',
        name: value['name'] as String? ?? 'Procedure',
        reason: value['reason'] as String? ?? '',
        state: value['state'] as String?,
        versionId: value['versionId'] as String?,
        runId: value['runId'] as String?,
      );
  String get identity => '$runId:$versionId:$action:$reason';
  String get label => switch (action) {
        'learned' => 'Procedure proposed',
        'reused' => 'Procedure reused',
        'suspended' => 'Needs revalidation',
        'revised' => 'Revision proposed',
        'validated' => 'Outcome verified',
        'retired' => 'Procedure retired',
        'abstained' => 'Reuse paused',
        _ => 'Procedure update',
      };
}

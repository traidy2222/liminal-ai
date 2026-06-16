class InboxTriageVerdict {
  InboxTriageVerdict({
    required this.category,
    required this.needsReply,
    required this.confidence,
    required this.summary,
    required this.suggestedLabel,
  });

  final String category;
  final bool needsReply;
  final double confidence;
  final String summary;
  final String suggestedLabel;

  factory InboxTriageVerdict.fromJson(Map<String, dynamic> json) {
    return InboxTriageVerdict(
      category: json['category'] as String? ?? 'fyi',
      needsReply: json['needsReply'] as bool? ?? false,
      confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
      summary: json['summary'] as String? ?? '',
      suggestedLabel: json['suggestedLabel'] as String? ?? '',
    );
  }

  bool get needsAction => category == 'urgent' || category == 'action';
}

class InboxTriagedItem {
  InboxTriagedItem({
    required this.itemId,
    required this.status,
    required this.subject,
    required this.from,
    required this.fromEmail,
    required this.snippet,
    required this.provider,
    required this.receivedAt,
    required this.verdict,
    required this.triagedAt,
  });

  final String itemId;
  final String status;
  final String subject;
  final String from;
  final String fromEmail;
  final String snippet;
  final String provider;
  final String receivedAt;
  final InboxTriageVerdict verdict;
  final String triagedAt;

  factory InboxTriagedItem.fromJson(Map<String, dynamic> json) {
    final message = json['message'];
    final msg = message is Map ? Map<String, dynamic>.from(message) : <String, dynamic>{};
    final verdictRaw = json['verdict'];
    return InboxTriagedItem(
      itemId: json['itemId'] as String? ?? '',
      status: json['status'] as String? ?? 'pending',
      subject: msg['subject'] as String? ?? '',
      from: msg['from'] as String? ?? '',
      fromEmail: msg['fromEmail'] as String? ?? '',
      snippet: msg['snippet'] as String? ?? '',
      provider: msg['provider'] as String? ?? '',
      receivedAt: msg['receivedAt'] as String? ?? '',
      verdict: verdictRaw is Map
          ? InboxTriageVerdict.fromJson(Map<String, dynamic>.from(verdictRaw))
          : InboxTriageVerdict(
              category: 'fyi',
              needsReply: false,
              confidence: 0,
              summary: '',
              suggestedLabel: '',
            ),
      triagedAt: json['triagedAt'] as String? ?? '',
    );
  }

  bool get isPending => status == 'pending' || status == 'labeled' || status == 'processing';
}

class InboxWatchRun {
  InboxWatchRun({
    required this.runId,
    required this.trigger,
    required this.startedAt,
    required this.finishedAt,
    required this.durationMs,
    required this.outcome,
    required this.summary,
    this.skipReason,
    this.provider,
    this.error,
    this.newCount = 0,
    this.triagedCount = 0,
    this.labeledCount = 0,
    this.needsActionCount = 0,
  });

  final String runId;
  final String trigger;
  final String startedAt;
  final String finishedAt;
  final int durationMs;
  final String outcome;
  final String summary;
  final String? skipReason;
  final String? provider;
  final String? error;
  final int newCount;
  final int triagedCount;
  final int labeledCount;
  final int needsActionCount;

  bool get isSkipped => outcome == 'skipped';

  factory InboxWatchRun.fromJson(Map<String, dynamic> json) {
    return InboxWatchRun(
      runId: json['runId'] as String? ?? '',
      trigger: json['trigger'] as String? ?? '',
      startedAt: json['startedAt'] as String? ?? '',
      finishedAt: json['finishedAt'] as String? ?? '',
      durationMs: (json['durationMs'] as num?)?.toInt() ?? 0,
      outcome: json['outcome'] as String? ?? 'skipped',
      summary: json['summary'] as String? ?? '',
      skipReason: json['skipReason'] as String?,
      provider: json['provider'] as String?,
      error: json['error'] as String?,
      newCount: (json['newCount'] as num?)?.toInt() ?? 0,
      triagedCount: (json['triagedCount'] as num?)?.toInt() ?? 0,
      labeledCount: (json['labeledCount'] as num?)?.toInt() ?? 0,
      needsActionCount: (json['needsActionCount'] as num?)?.toInt() ?? 0,
    );
  }

  String get triggerLabel => switch (trigger) {
        'manual' => 'Manual scan',
        'interval' => 'Scheduled',
        'boot' => 'Startup',
        'resume' => 'Resume',
        _ => trigger,
      };
}

class InboxSnapshot {
  InboxSnapshot({
    required this.lastScanAt,
    required this.nextScanAt,
    required this.needsActionCount,
    required this.fyiCount,
    required this.pendingCount,
    required this.items,
    required this.recentRuns,
  });

  final String? lastScanAt;
  final String? nextScanAt;
  final int needsActionCount;
  final int fyiCount;
  final int pendingCount;
  final List<InboxTriagedItem> items;
  final List<InboxWatchRun> recentRuns;

  factory InboxSnapshot.fromJson(Map<String, dynamic> json) {
    final itemsRaw = json['items'] as List<dynamic>? ?? [];
    final runsRaw = json['recentRuns'] as List<dynamic>? ?? [];
    return InboxSnapshot(
      lastScanAt: json['lastScanAt'] as String?,
      nextScanAt: json['nextScanAt'] as String?,
      needsActionCount: (json['needsActionCount'] as num?)?.toInt() ?? 0,
      fyiCount: (json['fyiCount'] as num?)?.toInt() ?? 0,
      pendingCount: (json['pendingCount'] as num?)?.toInt() ?? 0,
      items: itemsRaw
          .map((e) => InboxTriagedItem.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(),
      recentRuns: runsRaw
          .map((e) => InboxWatchRun.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(),
    );
  }

  static final empty = InboxSnapshot(
    lastScanAt: null,
    nextScanAt: null,
    needsActionCount: 0,
    fyiCount: 0,
    pendingCount: 0,
    items: [],
    recentRuns: [],
  );

  List<InboxTriagedItem> get pendingItems =>
      items.where((i) => i.isPending).toList();

  bool get hasVisibleItems => pendingCount > 0 || needsActionCount > 0;

  String get stripLabel {
    if (needsActionCount > 0 && pendingCount > needsActionCount) {
      return '$pendingCount new · $needsActionCount need you';
    }
    if (needsActionCount > 0) {
      return needsActionCount == 1 ? '1 needs you' : '$needsActionCount need you';
    }
    if (pendingCount > 0) {
      return pendingCount == 1 ? '1 new' : '$pendingCount new';
    }
    return '';
  }
}

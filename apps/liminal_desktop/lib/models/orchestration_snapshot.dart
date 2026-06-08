class WorkerHandoff {
  WorkerHandoff({
    required this.status,
    required this.artifacts,
    required this.commandsRun,
    required this.decisions,
    required this.blockers,
    required this.summary,
  });

  final String status;
  final List<String> artifacts;
  final List<String> commandsRun;
  final List<String> decisions;
  final List<String> blockers;
  final String summary;

  factory WorkerHandoff.fromJson(Map<String, dynamic> json) {
    List<String> strings(String key) => (json[key] as List<dynamic>? ?? [])
        .map((e) => e.toString())
        .where((s) => s.isNotEmpty)
        .toList();
    return WorkerHandoff(
      status: json['status'] as String? ?? 'done',
      artifacts: strings('artifacts'),
      commandsRun: strings('commandsRun'),
      decisions: strings('decisions'),
      blockers: strings('blockers'),
      summary: json['summary'] as String? ?? '',
    );
  }
}

class OrchestrationWorkerSnapshot {
  OrchestrationWorkerSnapshot({
    required this.taskId,
    required this.title,
    required this.status,
    this.chatId,
    this.summary,
    this.handoff,
    this.error,
  });

  final String taskId;
  final String title;
  final String status;
  final String? chatId;
  final String? summary;
  final WorkerHandoff? handoff;
  final String? error;

  factory OrchestrationWorkerSnapshot.fromJson(Map<String, dynamic> json) {
    final handoffRaw = json['handoff'];
    return OrchestrationWorkerSnapshot(
      taskId: json['taskId'] as String? ?? '',
      title: json['title'] as String? ?? 'Task',
      status: json['status'] as String? ?? 'pending',
      chatId: json['chatId'] as String?,
      summary: json['summary'] as String?,
      handoff: handoffRaw is Map
          ? WorkerHandoff.fromJson(Map<String, dynamic>.from(handoffRaw))
          : null,
      error: json['error'] as String?,
    );
  }

  bool get isRunning => status == 'running';
  bool get isDone => status == 'done';
  bool get isFailed => status == 'failed';
}

class OrchestrationSnapshot {
  OrchestrationSnapshot({
    required this.id,
    required this.goal,
    required this.status,
    required this.yolo,
    required this.workers,
    this.phase,
    this.synthesisChatId,
    this.summary,
    this.error,
    this.startedAt,
    this.finishedAt,
  });

  final String id;
  final String goal;
  final String status;
  final bool yolo;
  final List<OrchestrationWorkerSnapshot> workers;
  final String? phase;
  final String? synthesisChatId;
  final String? summary;
  final String? error;
  final int? startedAt;
  final int? finishedAt;

  bool get isActive =>
      status == 'planning' || status == 'running' || status == 'synthesizing';

  bool get isIdle => status == 'idle';

  factory OrchestrationSnapshot.fromJson(Map<String, dynamic> json) {
    final workersRaw = json['workers'] as List<dynamic>? ?? [];
    return OrchestrationSnapshot(
      id: json['id'] as String? ?? '',
      goal: json['goal'] as String? ?? '',
      status: json['status'] as String? ?? 'idle',
      yolo: json['yolo'] as bool? ?? true,
      phase: json['phase'] as String?,
      synthesisChatId: json['synthesisChatId'] as String?,
      summary: json['summary'] as String?,
      error: json['error'] as String?,
      startedAt: (json['startedAt'] as num?)?.toInt(),
      finishedAt: (json['finishedAt'] as num?)?.toInt(),
      workers: workersRaw
          .map((e) => OrchestrationWorkerSnapshot.fromJson(
                Map<String, dynamic>.from(e as Map),
              ))
          .toList(),
    );
  }

  static final empty = OrchestrationSnapshot(
    id: '',
    goal: '',
    status: 'idle',
    yolo: true,
    workers: [],
  );

  List<String> get workerChatIds => [
        for (final w in workers)
          if (w.chatId != null && w.chatId!.isNotEmpty) w.chatId!,
        if (synthesisChatId != null && synthesisChatId!.isNotEmpty)
          synthesisChatId!,
      ];
}

import 'package:flutter/material.dart';

import '../../models/orchestration_snapshot.dart';
import '../theme/liminal_theme_extension.dart';
import 'liminal_section.dart';

class OrchestratorPanel extends StatefulWidget {
  const OrchestratorPanel({
    super.key,
    required this.snapshot,
    required this.busy,
    required this.onStart,
    required this.onStop,
    required this.onViewChats,
  });

  final OrchestrationSnapshot snapshot;
  final bool busy;
  final Future<void> Function(String goal) onStart;
  final Future<void> Function() onStop;
  final Future<void> Function() onViewChats;

  @override
  State<OrchestratorPanel> createState() => _OrchestratorPanelState();
}

class _OrchestratorPanelState extends State<OrchestratorPanel> {
  final _goal = TextEditingController();
  bool _canStart = false;

  @override
  void initState() {
    super.initState();
    _goal.addListener(_onGoalChanged);
  }

  void _onGoalChanged() {
    final next = _goal.text.trim().isNotEmpty;
    if (next != _canStart && mounted) {
      setState(() => _canStart = next);
    }
  }

  @override
  void dispose() {
    _goal.removeListener(_onGoalChanged);
    _goal.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final snap = widget.snapshot;
    final running = snap.isActive;

    return LiminalSection(
      title: 'Orchestrator',
      subtitle:
          'Describe a mission — Vireon plans worker chats, runs them autonomously, and synthesizes a result.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _goal,
            enabled: !running && !widget.busy,
            minLines: 2,
            maxLines: 5,
            decoration: InputDecoration(
              hintText:
                  'e.g. Audit packages/core for context bugs, fix the top issue, and summarize what changed…',
              filled: true,
              fillColor: lim.surface.withValues(alpha: 0.45),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              if (running)
                FilledButton.icon(
                  onPressed: widget.busy ? null : () => widget.onStop(),
                  icon: const Icon(Icons.stop_circle_outlined, size: 18),
                  label: const Text('Stop'),
                  style: FilledButton.styleFrom(
                    backgroundColor: lim.danger,
                  ),
                )
              else
                FilledButton.icon(
                  onPressed: widget.busy || !_canStart
                      ? null
                      : () => widget.onStart(_goal.text.trim()),
                  icon: const Icon(Icons.rocket_launch_outlined, size: 18),
                  label: const Text('Run mission'),
                ),
              if (snap.workerChatIds.isNotEmpty) ...[
                const SizedBox(width: 8),
                OutlinedButton.icon(
                  onPressed: widget.busy ? null : () => widget.onViewChats(),
                  icon: const Icon(Icons.open_in_new, size: 18),
                  label: const Text('View chats'),
                ),
              ],
            ],
          ),
          if (snap.isActive || snap.status == 'completed' || snap.status == 'failed' || snap.status == 'stopped') ...[
            const SizedBox(height: 16),
            OrchestratorMissionBanner(snapshot: snap),
          ],
          if (snap.workers.isNotEmpty) ...[
            const SizedBox(height: 12),
            ...snap.workers.map((w) => _WorkerRow(worker: w)),
          ],
          if (snap.summary != null && snap.summary!.isNotEmpty) ...[
            const SizedBox(height: 14),
            Text(
              'Final result',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: lim.accent,
                    fontWeight: FontWeight.w600,
                  ),
            ),
            const SizedBox(height: 6),
            SelectableText(
              snap.summary!,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: lim.text,
                    height: 1.4,
                  ),
            ),
          ],
          if (snap.error != null && snap.error!.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              snap.error!,
              style: TextStyle(color: lim.danger, fontSize: 13),
            ),
          ],
        ],
      ),
    );
  }
}

/// Live mission status strip (hub or Mission Control chat).
class OrchestratorMissionBanner extends StatelessWidget {
  const OrchestratorMissionBanner({super.key, required this.snapshot});

  final OrchestrationSnapshot snapshot;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final label = switch (snapshot.status) {
      'planning' => 'Planning',
      'running' => 'Workers running',
      'synthesizing' => 'Synthesizing',
      'completed' => 'Completed',
      'failed' => 'Failed',
      'stopped' => 'Stopped',
      _ => snapshot.status,
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: lim.panel.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: lim.border),
      ),
      child: Row(
        children: [
          if (snapshot.isActive)
            Padding(
              padding: const EdgeInsets.only(right: 10),
              child: SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: lim.accent,
                ),
              ),
            ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        color: lim.text,
                        fontWeight: FontWeight.w600,
                      ),
                ),
                if (snapshot.phase != null && snapshot.phase!.isNotEmpty)
                  Text(
                    snapshot.phase!,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: lim.textMuted,
                        ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _WorkerRow extends StatelessWidget {
  const _WorkerRow({required this.worker});

  final OrchestrationWorkerSnapshot worker;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final icon = switch (worker.status) {
      'running' => Icons.bolt,
      'done' => Icons.check_circle_outline,
      'failed' => Icons.error_outline,
      _ => Icons.circle_outlined,
    };
    final color = switch (worker.status) {
      'running' => lim.accent,
      'done' => lim.accent,
      'failed' => lim.danger,
      _ => lim.textDim,
    };

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  worker.title,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: lim.text,
                        fontWeight: FontWeight.w500,
                      ),
                ),
                if (worker.handoff != null) ...[
                  Text(
                    'Handoff: ${worker.handoff!.status}'
                    '${worker.handoff!.artifacts.isNotEmpty ? ' · ${worker.handoff!.artifacts.length} artifact(s)' : ''}',
                    style: TextStyle(color: lim.textDim, fontSize: 12),
                  ),
                  if (worker.handoff!.blockers.isNotEmpty)
                    Text(
                      worker.handoff!.blockers.join('; '),
                      style: TextStyle(color: lim.danger, fontSize: 12),
                    ),
                ],
                if (worker.error != null)
                  Text(
                    worker.error!,
                    style: TextStyle(color: lim.danger, fontSize: 12),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

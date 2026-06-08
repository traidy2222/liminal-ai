import 'dart:convert';

import 'package:flutter/material.dart';

import '../../state/message_models.dart';
import '../theme/liminal_theme_extension.dart';

class ApprovalSheet extends StatelessWidget {
  const ApprovalSheet({
    super.key,
    required this.pending,
    required this.onApprove,
    required this.onReject,
    this.queueIndex = 1,
    this.queueTotal = 1,
  });

  final PendingApproval pending;
  final VoidCallback onApprove;
  final VoidCallback onReject;
  final int queueIndex;
  final int queueTotal;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final argsJson = const JsonEncoder.withIndent('  ').convert(pending.args);
    final summary = _spawnAppSummary(pending);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: lim.panel.withValues(alpha: 0.98),
        border: Border(
          top: BorderSide(color: lim.warn.withValues(alpha: 0.6), width: 2),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.gavel, color: lim.warn, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  queueTotal > 1
                      ? 'Approve tool: ${pending.name} ($queueIndex of $queueTotal)'
                      : 'Approve tool: ${pending.name}',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        color: lim.warn,
                      ),
                ),
              ),
            ],
          ),
          if (queueTotal > 1) ...[
            const SizedBox(height: 4),
            Text(
              '$queueTotal tools waiting — resolve each prompt to continue.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: lim.textMuted,
                  ),
            ),
          ],
          const SizedBox(height: 8),
          if (summary != null) ...[
            Text(
              summary,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: lim.text,
                  ),
            ),
            const SizedBox(height: 8),
          ],
          SizedBox(
            height: 120,
            child: SingleChildScrollView(
              child: Text(
                argsJson,
                style: TextStyle(
                  fontFamily: lim.fontFamilyMono,
                  fontSize: 12,
                  color: lim.textMuted,
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(
                onPressed: onReject,
                child: Text('Reject', style: TextStyle(color: lim.danger)),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: onApprove,
                style: FilledButton.styleFrom(backgroundColor: lim.success),
                child: const Text('Approve'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  static String? _spawnAppSummary(PendingApproval pending) {
    if (pending.name != 'spawn_app') return null;
    final args = pending.args;
    final type = args['type']?.toString() ?? 'unknown';
    final title = args['title']?.toString();
    final props = args['props'];
    final parts = <String>[
      'Desktop widget: type=$type',
      if (title != null && title.isNotEmpty) 'title="$title"',
    ];
    final shell = args['shell'];
    if (shell is Map && shell['mode'] == 'window') {
      parts[0] = 'Desktop window: type=$type';
    }
    final placement = args['placement'];
    if (placement is Map) {
      final w = placement['width'];
      final h = placement['height'];
      if (w != null && h != null) parts.add('${w}×$h');
    }
    if (props is Map) {
      final fetch = props['data_fetch'];
      if (fetch is Map && fetch['url'] != null) {
        parts.add('data_fetch=${fetch['url']}');
      }
      final hosts = props['proxy_hosts'];
      if (hosts is List && hosts.isNotEmpty) {
        parts.add('proxy_hosts=${hosts.join(", ")}');
      }
    }
    return parts.join(' · ');
  }
}

import 'dart:convert';

import 'package:flutter/material.dart';

import '../../state/message_models.dart';
import '../design_system/liminal_design_system.dart';
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
    return LiminalSheet(
      title: queueTotal > 1
          ? 'Approve tool: ${pending.name} ($queueIndex of $queueTotal)'
          : 'Approve tool: ${pending.name}',
      leading: Icon(Icons.gavel, color: lim.warn, size: 20),
      accentColor: lim.warn,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (queueTotal > 1)
            Text(
              '$queueTotal tools waiting — resolve each prompt to continue.',
              style: LiminalTypography.body(context),
            ),
          if (queueTotal > 1) const SizedBox(height: 8),
          if (summary != null) ...[
            Text(
              summary,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: lim.text),
            ),
            const SizedBox(height: 8),
          ],
          SizedBox(
            height: 120,
            child: SingleChildScrollView(
              child: Text(
                argsJson,
                style: LiminalTypography.mono(context, fontSize: 12, color: lim.textMuted),
              ),
            ),
          ),
        ],
      ),
      footer: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          LiminalButton(
            label: 'Reject',
            variant: LiminalButtonVariant.danger,
            onPressed: onReject,
          ),
          const SizedBox(width: 8),
          LiminalButton(
            label: 'Approve',
            onPressed: onApprove,
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

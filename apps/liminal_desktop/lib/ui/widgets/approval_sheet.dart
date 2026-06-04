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
  });

  final PendingApproval pending;
  final VoidCallback onApprove;
  final VoidCallback onReject;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final argsJson = const JsonEncoder.withIndent('  ').convert(pending.args);
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
                  'Approve tool: ${pending.name}',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        color: lim.warn,
                      ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
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
}

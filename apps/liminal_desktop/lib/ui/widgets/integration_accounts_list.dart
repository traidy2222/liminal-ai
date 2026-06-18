import 'package:flutter/material.dart';

import '../theme/liminal_theme_extension.dart';

class IntegrationAccountEntry {
  const IntegrationAccountEntry({
    required this.accountId,
    required this.label,
    this.meta,
  });

  final String accountId;
  final String label;
  final String? meta;
}

/// Linked OAuth accounts with per-account remove + optional disconnect-all.
class IntegrationAccountsList extends StatelessWidget {
  const IntegrationAccountsList({
    super.key,
    required this.accounts,
    required this.disabled,
    required this.onRemove,
    this.onDisconnectAll,
    this.disconnectAllLabel = 'Disconnect all',
  });

  final List<IntegrationAccountEntry> accounts;
  final bool disabled;
  final Future<void> Function(String accountId) onRemove;
  final Future<void> Function()? onDisconnectAll;
  final String disconnectAllLabel;

  @override
  Widget build(BuildContext context) {
    if (accounts.isEmpty) return const SizedBox.shrink();
    final lim = LiminalTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          accounts.length == 1 ? 'Linked account' : '${accounts.length} linked accounts',
          style: TextStyle(
            color: lim.textMuted,
            fontSize: 11,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.2,
          ),
        ),
        const SizedBox(height: 6),
        for (final a in accounts)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.account_circle_outlined, size: 16, color: lim.success),
                const SizedBox(width: 6),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        a.label,
                        style: TextStyle(
                          color: lim.text,
                          fontSize: 12,
                          fontFamily: 'monospace',
                        ),
                      ),
                      if (a.meta != null && a.meta!.isNotEmpty)
                        Text(
                          a.meta!,
                          style: TextStyle(color: lim.textDim, fontSize: 10, height: 1.3),
                        ),
                    ],
                  ),
                ),
                TextButton(
                  onPressed: disabled ? null : () => onRemove(a.accountId),
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    foregroundColor: lim.danger.withValues(alpha: 0.85),
                  ),
                  child: const Text('Remove', style: TextStyle(fontSize: 11)),
                ),
              ],
            ),
          ),
        if (onDisconnectAll != null) ...[
          const SizedBox(height: 4),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: disabled ? null : () => onDisconnectAll!(),
              style: TextButton.styleFrom(
                foregroundColor: lim.danger.withValues(alpha: 0.85),
                padding: EdgeInsets.zero,
              ),
              child: Text(disconnectAllLabel, style: const TextStyle(fontSize: 11)),
            ),
          ),
        ],
        const SizedBox(height: 8),
      ],
    );
  }
}

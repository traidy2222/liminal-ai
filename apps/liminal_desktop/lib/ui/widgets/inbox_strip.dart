import 'package:flutter/material.dart';

import '../../models/inbox_snapshot.dart';
import '../theme/liminal_theme_extension.dart';

class InboxStrip extends StatelessWidget {
  const InboxStrip({
    super.key,
    required this.snapshot,
    required this.onTap,
  });

  final InboxSnapshot snapshot;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    if (!snapshot.hasVisibleItems) return const SizedBox.shrink();

    final lim = LiminalTheme.of(context);
    final urgent = snapshot.needsActionCount > 0;

    return Material(
      color: urgent ? lim.accent.withValues(alpha: 0.08) : lim.surfaceRaised,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            children: [
              Icon(
                urgent ? Icons.mark_email_unread_outlined : Icons.inbox_outlined,
                size: 18,
                color: urgent ? lim.accent : lim.textDim,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  snapshot.stripLabel,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: urgent ? lim.accent : lim.text,
                      ),
                ),
              ),
              Icon(Icons.chevron_right, color: lim.textDim, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';

import '../../models/context_snapshot.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';

/// Compact context window meter above the composer.
class ContextMeter extends StatelessWidget {
  const ContextMeter({super.key, required this.snapshot});

  final ContextSnapshot snapshot;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final pct = snapshot.displayPercent;
    final color = pct >= 80
        ? lim.danger
        : pct >= 60
            ? lim.warn
            : lim.accent.withValues(alpha: 0.85);
    final tier = snapshot.contextTier;
    final tools = snapshot.toolTokenCount;

    return Padding(
      padding: const EdgeInsets.only(bottom: LiminalSpacing.xs),
      child: Row(
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(2),
              child: LinearProgressIndicator(
                value: snapshot.displayFraction.clamp(0.0, 1.0),
                minHeight: 3,
                backgroundColor: lim.surface.withValues(alpha: 0.5),
                color: color,
              ),
            ),
          ),
          const SizedBox(width: LiminalSpacing.xs),
          Text(
            'ctx $pct%${snapshot.masked ? ' · masked' : ''}',
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          if (tier != null) ...[
            const SizedBox(width: 6),
            Text(
              tier,
              style: TextStyle(
                color: lim.muted,
                fontSize: 10,
              ),
            ),
          ],
          if (tools != null && tools > 0) ...[
            const SizedBox(width: 6),
            Text(
              'tools ~${(tools / 1000).toStringAsFixed(0)}k',
              style: TextStyle(
                color: lim.muted,
                fontSize: 10,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

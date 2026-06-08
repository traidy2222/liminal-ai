import 'package:flutter/material.dart';

import '../theme/liminal_theme_extension.dart';

/// Platform wordmark for the Vireon desktop shell (above persona / Liminal modules).
class VireonBrandMark extends StatelessWidget {
  const VireonBrandMark({
    super.key,
    this.tagline,
    this.compact = false,
  });

  final String? tagline;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final titleStyle = (compact
            ? Theme.of(context).textTheme.titleLarge
            : Theme.of(context).textTheme.headlineMedium)
        ?.copyWith(
      color: lim.text,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.5,
    );

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _VireonGlyph(size: compact ? 30 : 40, accent: lim.accent, secondary: lim.secondary),
        SizedBox(width: compact ? 10 : 14),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Vireon', style: titleStyle),
              if (tagline != null && tagline!.isNotEmpty)
                Text(
                  tagline!,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: lim.textMuted,
                      ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _VireonGlyph extends StatelessWidget {
  const _VireonGlyph({
    required this.size,
    required this.accent,
    required this.secondary,
  });

  final double size;
  final Color accent;
  final Color secondary;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(size * 0.22),
        border: Border.all(color: accent.withValues(alpha: 0.7), width: 1.5),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            accent.withValues(alpha: 0.22),
            secondary.withValues(alpha: 0.08),
          ],
        ),
        boxShadow: [
          BoxShadow(
            color: accent.withValues(alpha: 0.2),
            blurRadius: 14,
          ),
        ],
      ),
      child: Center(
        child: Text(
          'V',
          style: TextStyle(
            color: accent,
            fontWeight: FontWeight.w800,
            fontSize: size * 0.46,
            height: 1,
          ),
        ),
      ),
    );
  }
}

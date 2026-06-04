import 'package:flutter/material.dart';

import '../theme/liminal_theme_extension.dart';

/// Liminal wordmark + accent orb (web header identity).
class LiminalBrandMark extends StatelessWidget {
  const LiminalBrandMark({
    super.key,
    this.subtitle,
    this.compact = false,
  });

  final String? subtitle;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalThemeExtension.of(context).tokens;
    final title = lim.displayLabel;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _Orb(accent: lim.accent, secondary: lim.secondary, size: compact ? 28 : 36),
        SizedBox(width: compact ? 10 : 14),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              ShaderMask(
                shaderCallback: (bounds) => LinearGradient(
                  colors: [lim.accent, lim.secondary],
                ).createShader(bounds),
                child: Text(
                  title,
                  style: (compact
                          ? Theme.of(context).textTheme.titleMedium
                          : Theme.of(context).textTheme.headlineMedium)
                      ?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              if (subtitle != null && subtitle!.isNotEmpty)
                Text(
                  subtitle!,
                  style: Theme.of(context).textTheme.bodySmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Orb extends StatelessWidget {
  const _Orb({
    required this.accent,
    required this.secondary,
    required this.size,
  });

  final Color accent;
  final Color secondary;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: accent.withValues(alpha: 0.85), width: 2),
        boxShadow: [
          BoxShadow(
            color: accent.withValues(alpha: 0.35),
            blurRadius: 12,
          ),
          BoxShadow(
            color: secondary.withValues(alpha: 0.2),
            blurRadius: 18,
            spreadRadius: 1,
          ),
        ],
        gradient: RadialGradient(
          colors: [
            accent.withValues(alpha: 0.35),
            Colors.transparent,
          ],
        ),
      ),
      child: Center(
        child: Container(
          width: size * 0.28,
          height: size * 0.28,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: accent,
          ),
        ),
      ),
    );
  }
}

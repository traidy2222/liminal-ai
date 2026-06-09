import 'package:flutter/material.dart';

import '../../layout/liminal_spacing.dart';
import '../../theme/liminal_theme_extension.dart';
import '../primitives/liminal_interactive.dart';
import '../tokens/liminal_typography.dart';

/// Standard navigable list row (hub chats, integrations, etc.).
class LiminalListRow extends StatelessWidget {
  const LiminalListRow({
    super.key,
    required this.title,
    this.subtitle,
    this.leading,
    this.trailing,
    this.onTap,
    this.enabled = true,
    this.monoSubtitle = false,
  });

  final String title;
  final String? subtitle;
  final Widget? leading;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool enabled;
  final bool monoSubtitle;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final canTap = enabled && onTap != null;

    return LiminalInteractive(
      enabled: canTap,
      onPressed: onTap,
      borderRadius: BorderRadius.circular(lim.radius * 0.8),
      builder: (context, hovered, focused) {
        return Padding(
          padding: const EdgeInsets.symmetric(
            vertical: LiminalSpacing.sm,
            horizontal: LiminalSpacing.xs,
          ),
          child: Row(
            children: [
              if (leading != null) ...[
                leading!,
                const SizedBox(width: LiminalSpacing.sm),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            color: lim.text,
                            fontWeight: hovered || focused ? FontWeight.w600 : FontWeight.w500,
                          ),
                    ),
                    if (subtitle != null && subtitle!.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitle!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: monoSubtitle
                            ? LiminalTypography.mono(context, fontSize: 11, color: lim.textDim)
                            : LiminalTypography.caption(context),
                      ),
                    ],
                  ],
                ),
              ),
              trailing ??
                  Icon(Icons.chevron_right, color: lim.textMuted, size: 20),
            ],
          ),
        );
      },
    );
  }
}

import 'package:flutter/material.dart';

import '../../layout/liminal_spacing.dart';
import '../primitives/liminal_card.dart';
import '../tokens/liminal_typography.dart';

/// Titled block with optional description — content in a [LiminalCard].
class LiminalSection extends StatelessWidget {
  const LiminalSection({
    super.key,
    required this.title,
    required this.child,
    this.subtitle,
    this.trailing,
  });

  final String title;
  final String? subtitle;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: LiminalTypography.sectionTitle(context)),
                  if (subtitle != null && subtitle!.isNotEmpty) ...[
                    const SizedBox(height: LiminalSpacing.xxs),
                    Text(subtitle!, style: LiminalTypography.body(context)),
                  ],
                ],
              ),
            ),
            if (trailing != null) trailing!,
          ],
        ),
        const SizedBox(height: LiminalSpacing.sm),
        LiminalCard(child: child),
      ],
    );
  }
}

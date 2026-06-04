import 'package:flutter/material.dart';

import '../theme/liminal_theme_extension.dart';

/// App bar title that never collides with action icons.
class LiminalAppBarTitle extends StatelessWidget {
  const LiminalAppBarTitle({
    super.key,
    required this.title,
    this.subtitle,
  });

  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        return SizedBox(
          width: constraints.maxWidth,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      color: lim.text,
                      fontWeight: FontWeight.w600,
                    ),
              ),
              if (subtitle != null && subtitle!.isNotEmpty)
                Text(
                  subtitle!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: lim.textMuted,
                      ),
                ),
            ],
          ),
        );
      },
    );
  }
}

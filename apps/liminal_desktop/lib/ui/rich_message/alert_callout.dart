import 'package:flutter/material.dart';

import '../theme/liminal_theme_extension.dart';

final _alertMeta = {
  'NOTE': (icon: Icons.info_outline, colorKey: 'note'),
  'TIP': (icon: Icons.lightbulb_outline, colorKey: 'tip'),
  'WARNING': (icon: Icons.warning_amber_outlined, colorKey: 'warn'),
  'IMPORTANT': (icon: Icons.star_outline, colorKey: 'important'),
  'CAUTION': (icon: Icons.local_fire_department_outlined, colorKey: 'caution'),
};

class AlertCallout extends StatelessWidget {
  const AlertCallout({super.key, required this.type, required this.body});

  final String type;
  final String body;

  static ({String type, String body})? parseAlertBlockquote(String text) {
    final match = RegExp(
      r'^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*',
      caseSensitive: false,
    ).firstMatch(text.trimLeft());
    if (match == null) return null;
    return (
      type: match.group(1)!.toUpperCase(),
      body: text.trimLeft().substring(match.end).trim(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final meta = _alertMeta[type] ?? _alertMeta['NOTE']!;
    final color = switch (meta.colorKey) {
      'tip' => lim.success,
      'warn' => lim.warn,
      'caution' => lim.danger,
      'important' => lim.secondary,
      _ => lim.accent,
    };

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 10),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(5),
        border: Border(
          left: BorderSide(color: color, width: 3),
          top: BorderSide(color: color.withValues(alpha: 0.25)),
          right: BorderSide(color: color.withValues(alpha: 0.25)),
          bottom: BorderSide(color: color.withValues(alpha: 0.25)),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(meta.icon, size: 16, color: color),
              const SizedBox(width: 8),
              Text(
                type,
                style: LiminalTheme.mono(
                  context,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
              ),
            ],
          ),
          if (body.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              body,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: lim.text,
                    height: 1.45,
                  ),
            ),
          ],
        ],
      ),
    );
  }
}

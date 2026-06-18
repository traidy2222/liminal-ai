import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:url_launcher/url_launcher.dart';

import '../theme/liminal_theme_extension.dart';
import 'markdown_style_sheet.dart';
import 'video_embed.dart';

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

  /// Keep the callout to the summary line; render tables/sections below it.
  static ({String summary, String? remainder}) splitCalloutBody(String body) {
    final heading = RegExp(r'\n#{1,6}\s').firstMatch(body);
    if (heading != null && heading.start > 0) {
      return (
        summary: body.substring(0, heading.start).trim(),
        remainder: body.substring(heading.start).trim(),
      );
    }
    final table = RegExp(r'\n\|[^\n]+\|').firstMatch(body);
    if (table != null && table.start > 0) {
      return (
        summary: body.substring(0, table.start).trim(),
        remainder: body.substring(table.start).trim(),
      );
    }
    return (summary: body, remainder: null);
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final split = splitCalloutBody(body);
    final summary = split.summary;
    final remainder = split.remainder;
    final meta = _alertMeta[type] ?? _alertMeta['NOTE']!;
    final color = switch (meta.colorKey) {
      'tip' => lim.success,
      'warn' => lim.warn,
      'caution' => lim.danger,
      'important' => lim.secondary,
      _ => lim.accent,
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
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
              if (summary.isNotEmpty) ...[
                const SizedBox(height: 6),
                MarkdownBody(
                  data: summary,
                  selectable: false,
                  softLineBreak: true,
                  extensionSet: md.ExtensionSet.gitHubWeb,
                  styleSheet: liminalMarkdownStyleSheet(context, lim),
                  onTapLink: (text, href, title) {
                    if (href == null) return;
                    if (detectVideoEmbed(href) != null) return;
                    final uri = Uri.tryParse(href);
                    if (uri != null) {
                      launchUrl(uri, mode: LaunchMode.externalApplication);
                    }
                  },
                ),
              ],
            ],
          ),
        ),
        if (remainder != null && remainder.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: MarkdownBody(
              data: remainder,
              selectable: false,
              softLineBreak: true,
              extensionSet: md.ExtensionSet.gitHubWeb,
              styleSheet: liminalMarkdownStyleSheet(context, lim),
              onTapLink: (text, href, title) {
                if (href == null) return;
                if (detectVideoEmbed(href) != null) return;
                final uri = Uri.tryParse(href);
                if (uri != null) {
                  launchUrl(uri, mode: LaunchMode.externalApplication);
                }
              },
            ),
          ),
      ],
    );
  }
}

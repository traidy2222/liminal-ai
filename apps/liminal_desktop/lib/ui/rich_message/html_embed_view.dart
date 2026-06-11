import 'package:flutter/material.dart';
import 'package:flutter_widget_from_html/flutter_widget_from_html.dart';
import 'package:url_launcher/url_launcher.dart';

import '../theme/liminal_theme_extension.dart';
import 'html_sanitizer.dart';
import 'liminal_markdown_utils.dart';

/// Live HTML embed (fenced ```html``` or streaming open fence).
///
/// Uses [HtmlWidget] instead of a native WebView so the Agent shell terminal
/// can keep the sole WebView2 instance in the chat workspace (stacked WebViews
/// on Windows have been crashing the process at end-of-turn).
class HtmlEmbedView extends StatelessWidget {
  const HtmlEmbedView({
    super.key,
    required this.html,
    this.streaming = false,
    this.backgroundColor = '#0a0e14',
  });

  final String html;
  final bool streaming;
  final String backgroundColor;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final raw = streaming ? balanceHtmlForStreamingPreview(html) : html;
    final clean = sanitizeEmbedHtml(raw);
    if (clean.isEmpty) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: _parseHexColor(backgroundColor) ?? const Color(0xFF0A0E14),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: lim.border.withValues(alpha: 0.5)),
      ),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 48, maxHeight: 2400),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(12),
          child: HtmlWidget(
            clean,
            onTapUrl: (url) async {
              final uri = Uri.tryParse(url);
              if (uri != null) {
                await launchUrl(uri, mode: LaunchMode.externalApplication);
              }
              return true;
            },
            textStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: lim.text,
                  height: 1.5,
                ),
          ),
        ),
      ),
    );
  }
}

Color? _parseHexColor(String hex) {
  var s = hex.trim();
  if (s.startsWith('#')) s = s.substring(1);
  if (s.length == 6) s = 'FF$s';
  if (s.length != 8) return null;
  final value = int.tryParse(s, radix: 16);
  return value == null ? null : Color(value);
}

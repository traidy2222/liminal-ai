import 'package:flutter/material.dart';
import 'package:flutter_widget_from_html/flutter_widget_from_html.dart';
import 'package:url_launcher/url_launcher.dart';

import '../rich_message/html_sanitizer.dart';
import '../rich_message/liminal_markdown_utils.dart';

/// Live HTML email preview — inline styles via [HtmlWidget] (no native WebView).
///
/// Avoids a second WebView2 overlay while the Agent shell terminal is open.
class EmailHtmlPreview extends StatelessWidget {
  const EmailHtmlPreview({
    super.key,
    required this.html,
    this.streaming = false,
  });

  final String html;
  final bool streaming;

  @override
  Widget build(BuildContext context) {
    if (html.trim().isEmpty) return const SizedBox.shrink();

    final theme = Theme.of(context);
    final balanced = streaming ? balanceHtmlForStreamingPreview(html) : html;
    var clean = sanitizeEmailPreviewHtml(balanced);
    if (clean.isEmpty && balanced.trim().isNotEmpty) {
      // Last resort: fragment-only pass (e.g. unusual tags) — still try embed path.
      clean = sanitizeEmbedHtml(extractEmailHtmlBodyFragment(balanced));
    }

    if (clean.isEmpty) {
      return ColoredBox(
        color: const Color(0xFFECECEC),
        child: Scrollbar(
          thumbVisibility: true,
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(12),
            child: SelectableText(
              balanced,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontFamily: 'Consolas, Courier New, monospace',
                fontSize: 12.5,
                height: 1.45,
                color: const Color(0xFF333333),
              ),
            ),
          ),
        ),
      );
    }

    return ColoredBox(
      color: const Color(0xFFECECEC),
      child: Scrollbar(
        thumbVisibility: true,
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
            textStyle: theme.textTheme.bodyMedium?.copyWith(
              fontSize: 14,
              height: 1.5,
              color: const Color(0xFF333333),
            ),
          ),
        ),
      ),
    );
  }
}

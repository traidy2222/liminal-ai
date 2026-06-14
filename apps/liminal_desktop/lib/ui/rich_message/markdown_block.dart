import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_widget_from_html/flutter_widget_from_html.dart';
import 'package:highlight/highlight.dart' show highlight;
import 'package:highlight/languages/dart.dart' show dart;
import 'package:highlight/languages/javascript.dart' show javascript;
import 'package:highlight/languages/json.dart' show json;
import 'package:highlight/languages/python.dart' show python;
import 'package:highlight/languages/typescript.dart' show typescript;
import 'package:markdown/markdown.dart' as md;
import 'package:url_launcher/url_launcher.dart';

import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';
import 'alert_callout.dart';
import 'asset_url_resolver.dart';
import 'html_embed_view.dart';
import 'html_sanitizer.dart';
import 'liminal_markdown_utils.dart';
import 'markdown_style_sheet.dart';
import 'video_embed.dart';

class LiminalMarkdownBlock extends StatelessWidget {
  const LiminalMarkdownBlock({
    super.key,
    required this.data,
    this.streaming = false,
  });

  final String data;
  final bool streaming;

  static var _highlightReady = false;

  static void _ensureHighlight() {
    if (_highlightReady) return;
    _highlightReady = true;
    highlight.registerLanguage('dart', dart);
    highlight.registerLanguage('javascript', javascript);
    highlight.registerLanguage('json', json);
    highlight.registerLanguage('python', python);
    highlight.registerLanguage('typescript', typescript);
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    _ensureHighlight();

    if (looksLikeInlineHtmlFragment(data)) {
      final clean = sanitizeEmbedHtml(data);
      if (clean.isNotEmpty) {
        return HtmlWidget(
          clean,
          onTapUrl: (url) async {
            final uri = Uri.tryParse(url);
            if (uri != null) {
              await launchUrl(uri, mode: LaunchMode.externalApplication);
            }
            return true;
          },
          textStyle: Theme.of(context).textTheme.bodyLarge?.copyWith(
                color: lim.text,
                height: 1.72,
              ),
        );
      }
    }

    return MarkdownBody(
      data: data,
      selectable: false,
      softLineBreak: true,
      extensionSet: md.ExtensionSet.gitHubWeb,
      styleSheet: liminalMarkdownStyleSheet(context, lim),
      builders: {
        'pre': _PreElementBuilder(streaming: streaming, lim: lim),
        'blockquote': _AlertBlockquoteBuilder(lim: lim),
        'img': _ImageElementBuilder(lim: lim),
      },
      onTapLink: (text, href, title) {
        if (href == null) return;
        if (detectVideoEmbed(href) != null) return;
        final uri = Uri.tryParse(href);
        if (uri != null) {
          launchUrl(uri, mode: LaunchMode.externalApplication);
        }
      },
    );
  }
}

class _PreElementBuilder extends MarkdownElementBuilder {
  _PreElementBuilder({required this.streaming, required this.lim});

  final bool streaming;
  final LiminalTokens lim;

  @override
  Widget? visitElementAfter(md.Element element, TextStyle? preferredStyle) {
    final code = element.textContent.trim();
    String? lang;
    if (element.children != null && element.children!.isNotEmpty) {
      final child = element.children!.first;
      if (child is md.Element) {
        final cn = child.attributes['class'] ?? '';
        final m = RegExp(r'language-(\w+)').firstMatch(cn);
        lang = m?.group(1);
      }
    }

    if (isHtmlEmbedLang(lang)) {
      return HtmlEmbedView(html: code, streaming: streaming);
    }

    return _codeBlock(code, lang: lang);
  }

  Widget _codeBlock(String code, {String? lang}) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: lim.border.withValues(alpha: 0.5)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (lang != null && lang.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              color: lim.surface.withValues(alpha: 0.9),
              child: Text(
                lang,
                style: TextStyle(
                  fontFamily: lim.fontFamilyMono,
                  fontSize: 10,
                  color: lim.textDim,
                ),
              ),
            ),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            color: lim.codeBackground,
            child: Text(
              code,
              style: TextStyle(
                fontFamily: lim.fontFamilyMono,
                fontSize: 13,
                color: lim.text,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AlertBlockquoteBuilder extends MarkdownElementBuilder {
  _AlertBlockquoteBuilder({required this.lim});

  final LiminalTokens lim;

  @override
  Widget? visitElementAfter(md.Element element, TextStyle? preferredStyle) {
    final text = element.textContent.trim();
    final parsed = AlertCallout.parseAlertBlockquote(text);
    if (parsed != null) {
      return AlertCallout(type: parsed.type, body: parsed.body);
    }
    // Default blockquote — let MarkdownStyleSheet.blockquote* handle visuals;
    // return null so flutter_markdown renders children inline in the quote style.
    return null;
  }
}

class _ImageElementBuilder extends MarkdownElementBuilder {
  _ImageElementBuilder({required this.lim});

  final LiminalTokens lim;

  @override
  Widget? visitElementAfter(md.Element element, TextStyle? preferredStyle) {
    final src = element.attributes['src'];
    final resolved = assetUrlResolver.resolveImageSrc(src);
    if (resolved == null) return const SizedBox.shrink();

    final embed = detectVideoEmbed(resolved);
    if (embed != null) {
      return HtmlEmbedView(
        html: videoEmbedIframeHtml(embed),
        backgroundColor: '#010305',
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(6),
        child: Image.network(
          resolved,
          fit: BoxFit.contain,
          loadingBuilder: (ctx, child, progress) {
            if (progress == null) return child;
            return SizedBox(
              height: 80,
              child: Center(
                child: CircularProgressIndicator(
                  value: progress.expectedTotalBytes != null
                      ? progress.cumulativeBytesLoaded /
                          progress.expectedTotalBytes!
                      : null,
                ),
              ),
            );
          },
          errorBuilder: (_, __, ___) => Text(
            'Image failed to load',
            style: TextStyle(color: lim.textDim, fontSize: 12),
          ),
        ),
      ),
    );
  }
}

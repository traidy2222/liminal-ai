import 'package:flutter/material.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
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
import 'video_embed.dart';

bool _isRegisteredLanguage(String lang) {
  const known = {'dart', 'javascript', 'json', 'python', 'typescript'};
  return known.contains(lang.toLowerCase());
}

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
                height: 1.5,
              ),
        );
      }
    }

    return MarkdownBody(
      data: data,
      selectable: true,
      extensionSet: md.ExtensionSet.gitHubWeb,
      styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
        p: Theme.of(context).textTheme.bodyLarge?.copyWith(
              color: lim.text,
              height: 1.5,
            ),
        listBullet: Theme.of(context).textTheme.bodyLarge?.copyWith(color: lim.text),
        h1: Theme.of(context).textTheme.titleLarge?.copyWith(color: lim.success),
        h2: Theme.of(context).textTheme.titleMedium?.copyWith(color: lim.accent),
        h3: Theme.of(context).textTheme.titleSmall?.copyWith(color: lim.text),
        a: TextStyle(color: lim.accent, decoration: TextDecoration.underline),
        code: TextStyle(
          fontFamily: lim.fontFamilyMono,
          fontSize: 13,
          color: lim.text,
          backgroundColor: lim.codeBackground,
        ),
        tableBorder: TableBorder.all(color: lim.border.withValues(alpha: 0.6)),
        tableCellsPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        blockquote: Theme.of(context).textTheme.bodyMedium?.copyWith(color: lim.textMuted),
      ),
      builders: {
        'pre': _PreElementBuilder(streaming: streaming, lim: lim),
        'blockquote': _AlertBlockquoteBuilder(lim: lim),
        'img': _ImageElementBuilder(lim: lim),
        'a': _LinkElementBuilder(lim: lim),
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

    final hasHighlight = lang != null && _isRegisteredLanguage(lang);

    if (hasHighlight) {
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
            HighlightView(
              code,
              language: lang,
              theme: {
                'root': TextStyle(
                  backgroundColor: lim.codeBackground,
                  color: lim.text,
                  fontFamily: lim.fontFamilyMono,
                  fontSize: 13,
                ),
              },
              padding: const EdgeInsets.all(12),
              textStyle: TextStyle(
                fontFamily: lim.fontFamilyMono,
                fontSize: 13,
                color: lim.text,
              ),
            ),
          ],
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: lim.codeBackground,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: lim.border.withValues(alpha: 0.4)),
      ),
      child: SelectableText(
        code,
        style: TextStyle(
          fontFamily: lim.fontFamilyMono,
          fontSize: 12,
          color: lim.text,
          height: 1.35,
        ),
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
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsets.only(left: 12),
      decoration: BoxDecoration(
        border: Border(left: BorderSide(color: lim.border, width: 3)),
      ),
      child: Text(
        text,
        style: TextStyle(color: lim.textMuted, height: 1.4),
      ),
    );
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

class _LinkElementBuilder extends MarkdownElementBuilder {
  _LinkElementBuilder({required this.lim});

  final LiminalTokens lim;

  @override
  Widget? visitElementAfter(md.Element element, TextStyle? preferredStyle) {
    final href = element.attributes['href'] ?? '';
    final label = element.textContent;
    final embed = detectVideoEmbed(href.isNotEmpty ? href : label);
    if (embed != null) {
      return HtmlEmbedView(
        html: videoEmbedIframeHtml(embed),
        backgroundColor: '#010305',
      );
    }
    return GestureDetector(
      onTap: () {
        final uri = Uri.tryParse(href);
        if (uri != null) {
          launchUrl(uri, mode: LaunchMode.externalApplication);
        }
      },
      child: Text(
        label,
        style: TextStyle(
          color: lim.accent,
          decoration: TextDecoration.underline,
          decorationStyle: TextDecorationStyle.dotted,
        ),
      ),
    );
  }
}

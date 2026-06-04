import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../theme/liminal_theme_extension.dart';
import 'html_sanitizer.dart';
import 'liminal_markdown_utils.dart';

/// Live HTML embed (fenced ```html``` or streaming open fence).
class HtmlEmbedView extends StatefulWidget {
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
  State<HtmlEmbedView> createState() => _HtmlEmbedViewState();
}

class _HtmlEmbedViewState extends State<HtmlEmbedView> {
  WebViewController? _controller;
  double _height = 120;

  @override
  void didUpdateWidget(covariant HtmlEmbedView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.html != widget.html || oldWidget.streaming != widget.streaming) {
      _load();
    }
  }

  @override
  void initState() {
    super.initState();
    _initController();
    _load();
  }

  void _initController() {
    _controller = WebViewController()
      // Unrestricted only for scrollHeight probe on our sanitized document.
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.transparent)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (req) {
            final u = req.url.toLowerCase();
            if (u.startsWith('about:') || u.startsWith('data:text/html')) {
              return NavigationDecision.navigate;
            }
            return NavigationDecision.prevent;
          },
          onPageFinished: (_) => _measureHeight(),
        ),
      );
  }

  Future<void> _measureHeight() async {
    final c = _controller;
    if (c == null) return;
    try {
      final result = await c.runJavaScriptReturningResult(
        'Math.min(2400, Math.max(48, document.body.scrollHeight + 16))',
      );
      final h = double.tryParse(result.toString()) ?? 120;
      if (mounted && (h - _height).abs() > 4) {
        setState(() => _height = h.clamp(48, 2400));
      }
    } catch (_) {
      /* height probe optional */
    }
  }

  void _load() {
    final raw = widget.streaming
        ? balanceHtmlForStreamingPreview(widget.html)
        : widget.html;
    final clean = sanitizeEmbedHtml(raw);
    if (clean.isEmpty) return;
    final doc = wrapHtmlDocument(clean, background: widget.backgroundColor);
    _controller?.loadHtmlString(doc);
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final c = _controller;
    if (c == null) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: lim.border.withValues(alpha: 0.5)),
      ),
      clipBehavior: Clip.antiAlias,
      child: SizedBox(
        height: _height,
        width: double.infinity,
        child: WebViewWidget(controller: c),
      ),
    );
  }
}

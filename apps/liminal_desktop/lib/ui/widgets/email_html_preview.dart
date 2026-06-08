import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../rich_message/html_sanitizer.dart';
import '../rich_message/liminal_markdown_utils.dart';

/// Live HTML email preview — renders like a mail client (inline styles preserved).
class EmailHtmlPreview extends StatefulWidget {
  const EmailHtmlPreview({
    super.key,
    required this.html,
    this.streaming = false,
  });

  final String html;
  final bool streaming;

  @override
  State<EmailHtmlPreview> createState() => _EmailHtmlPreviewState();
}

class _EmailHtmlPreviewState extends State<EmailHtmlPreview> {
  WebViewController? _controller;
  String _loadedKey = '';
  double _lastLayoutWidth = -1;

  @override
  void initState() {
    super.initState();
    _initController();
    _load();
  }

  @override
  void didUpdateWidget(covariant EmailHtmlPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.html != widget.html || oldWidget.streaming != widget.streaming) {
      _load();
    }
  }

  void _initController() {
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFECECEC))
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (req) {
            final u = req.url.toLowerCase();
            if (u.startsWith('about:') || u.startsWith('data:text/html')) {
              return NavigationDecision.navigate;
            }
            return NavigationDecision.prevent;
          },
        ),
      );
  }

  void _load({bool force = false}) {
    final raw = widget.streaming
        ? balanceHtmlForStreamingPreview(widget.html)
        : widget.html;
    final clean = sanitizeEmbedHtml(raw);
    if (clean.isEmpty) return;

    final key = '${widget.streaming}|$clean';
    if (!force && key == _loadedKey) return;
    _loadedKey = key;

    final doc = wrapEmailPreviewDocument(clean);
    _controller?.loadHtmlString(doc);
  }

  @override
  Widget build(BuildContext context) {
    final c = _controller;
    if (c == null || widget.html.trim().isEmpty) {
      return const SizedBox.shrink();
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final w = constraints.maxWidth;
        final h = constraints.maxHeight;
        if (!w.isFinite || !h.isFinite || w <= 0 || h <= 0) {
          return const SizedBox.shrink();
        }

        if ((_lastLayoutWidth - w).abs() > 8) {
          _lastLayoutWidth = w;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) _load(force: true);
          });
        }

        return ClipRect(
          child: SizedBox(
            width: w,
            height: h,
            child: WebViewWidget(controller: c),
          ),
        );
      },
    );
  }
}

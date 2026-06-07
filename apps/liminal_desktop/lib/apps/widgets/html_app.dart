import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../models/liminal_app_spec.dart';
import 'widget_shell.dart';

/// Sandboxed WebView shell for html/markdown/chart/table/iframe desktop apps.
class HtmlApp extends StatefulWidget {
  const HtmlApp({
    super.key,
    required this.spec,
    required this.cache,
    required this.accent,
    this.sidecarPort,
    this.sidecarToken,
    this.reloadToken = 0,
    this.onRefresh,
    this.onHide,
  });

  final LiminalAppSpec spec;
  final AppCacheEntry? cache;
  final Color accent;
  final int? sidecarPort;
  final String? sidecarToken;
  final int reloadToken;
  final VoidCallback? onRefresh;
  final VoidCallback? onHide;

  @override
  State<HtmlApp> createState() => _HtmlAppState();
}

class _HtmlAppState extends State<HtmlApp> {
  WebViewController? _controller;
  String? _error;
  bool _loading = true;

  bool get _sandboxJs {
    final mode = widget.spec.props['interactivity'];
    if (mode == 'static') return false;
    return widget.spec.type == 'html' || widget.spec.type == 'iframe';
  }

  @override
  void initState() {
    super.initState();
    _initController();
    _loadDocument();
  }

  @override
  void didUpdateWidget(covariant HtmlApp oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.reloadToken != widget.reloadToken ||
        oldWidget.sidecarPort != widget.sidecarPort ||
        oldWidget.sidecarToken != widget.sidecarToken) {
      _loadDocument();
      return;
    }
    if (oldWidget.cache?.fetchedAt != widget.cache?.fetchedAt &&
        widget.cache != null) {
      _pushCacheToPage();
    }
  }

  void _initController() {
    _controller = WebViewController()
      ..setJavaScriptMode(
        _sandboxJs ? JavaScriptMode.unrestricted : JavaScriptMode.disabled,
      )
      ..setBackgroundColor(const Color(0xFF121820))
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (req) {
            final u = req.url.toLowerCase();
            if (u.startsWith('about:') || u.startsWith('data:')) {
              return NavigationDecision.navigate;
            }
            if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) {
              if (u.contains('/app_html') || u.contains('/app_proxy')) {
                return NavigationDecision.navigate;
              }
            }
            return NavigationDecision.prevent;
          },
          onPageFinished: (_) {
            if (mounted) setState(() => _loading = false);
            _pushCacheToPage();
          },
          onWebResourceError: (err) {
            if (mounted) {
              setState(() {
                _error = err.description;
                _loading = false;
              });
            }
          },
        ),
      );
  }

  Uri? _documentUri() {
    final port = widget.sidecarPort;
    final token = widget.sidecarToken;
    if (port == null || token == null || token.isEmpty) return null;
    return Uri.parse(
      'http://127.0.0.1:$port/app_html?token=${Uri.encodeComponent(token)}&appId=${Uri.encodeComponent(widget.spec.id)}',
    );
  }

  Future<void> _loadDocument() async {
    final c = _controller;
    if (c == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    final uri = _documentUri();
    if (uri == null) {
      setState(() {
        _loading = false;
        _error = 'Sidecar not ready — cannot load widget HTML.';
      });
      return;
    }
    try {
      final client = HttpClient();
      final request = await client.getUrl(uri);
      final response = await request.close();
      if (response.statusCode != 200) {
        throw HttpException('HTTP ${response.statusCode}', uri: uri);
      }
      final html = await response.transform(utf8.decoder).join();
      client.close(force: true);
      if (html.trim().isEmpty) {
        throw const FormatException('Widget HTML was empty');
      }
      await c.loadHtmlString(html, baseUrl: uri.toString());
      if (mounted) {
        setState(() => _loading = false);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Failed to load widget HTML: $e';
          _loading = false;
        });
      }
    }
  }

  Future<void> _pushCacheToPage() async {
    final c = _controller;
    final cache = widget.cache;
    if (c == null || cache == null) return;
    if (!_sandboxJs) return;
    try {
      final payload = jsonEncode(cache.toJson());
      await c.runJavaScript(
        'window.__LIMINAL__ && window.__LIMINAL__.applyData($payload);',
      );
    } catch (_) {
      /* optional live update */
    }
  }

  Widget _buildContent() {
    final c = _controller;
    return Stack(
      fit: StackFit.expand,
      children: [
        if (c != null) WebViewWidget(controller: c),
        if (_loading)
          Center(child: CircularProgressIndicator(color: widget.accent)),
        if (_error != null)
          Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(_error!, textAlign: TextAlign.center),
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final content = _buildContent();
    if (widget.spec.isWidgetMode) {
      return WidgetShell(
        title: widget.spec.title,
        accent: widget.accent,
        onRefresh: widget.onRefresh,
        onHide: widget.onHide,
        child: content,
      );
    }
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.spec.title),
        actions: [
          if (widget.onRefresh != null)
            IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: 'Refresh data',
              onPressed: widget.onRefresh,
            ),
        ],
      ),
      body: content,
    );
  }
}

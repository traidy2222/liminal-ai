import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../models/browser_view_state.dart';
import '../layout/liminal_spacing.dart';
import '../rich_message/asset_url_resolver.dart';
import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';
import 'desktop_webview_host.dart';
import 'desktop_webview_lifecycle.dart';

/// Native WebView2 browser panel — loads the agent session URL with bidirectional sync.
class BrowserDock extends StatefulWidget {
  const BrowserDock({
    super.key,
    required this.view,
    required this.expanded,
    required this.onToggleExpanded,
    this.width = 420,
    this.collapsedWidth = 44,
  });

  final BrowserViewState view;
  final bool expanded;
  final VoidCallback onToggleExpanded;
  final double width;
  final double collapsedWidth;

  @override
  State<BrowserDock> createState() => _BrowserDockState();
}

class _BrowserDockState extends State<BrowserDock> {
  WebViewController? _controller;
  String? _mountedSessionId;
  String? _loadedUrl;
  String? _loadError;
  bool _loadingFromAgent = false;
  bool _canGoBack = false;
  bool _canGoForward = false;
  int _controllerGen = 0;
  final _cookieManager = WebViewCookieManager();

  bool get _useNativeWebView {
    final mode = widget.view.embedMode;
    return mode != 'screencast';
  }

  @override
  void initState() {
    super.initState();
    assetUrlResolver.addListener(_onResolverChanged);
    _syncWebView();
  }

  @override
  void dispose() {
    assetUrlResolver.removeListener(_onResolverChanged);
    unawaited(_disposeController());
    super.dispose();
  }

  void _onResolverChanged() {
    if (_useNativeWebView) _syncWebView(forceReload: true);
  }

  @override
  void didUpdateWidget(covariant BrowserDock oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.view.sessionId != widget.view.sessionId ||
        oldWidget.view.url != widget.view.url ||
        oldWidget.expanded != widget.expanded ||
        oldWidget.view.embedMode != widget.view.embedMode) {
      _syncWebView();
    }
  }

  Future<void> _disposeController() async {
    final c = _controller;
    _controller = null;
    _mountedSessionId = null;
    await disposeDesktopWebView(c);
  }

  void _syncWebView({bool forceReload = false}) {
    if (!_useNativeWebView || !widget.view.open || !widget.expanded) {
      unawaited(_disposeController());
      return;
    }

    final sessionId = widget.view.sessionId;
    final url = widget.view.url.trim();
    if (sessionId.isEmpty) {
      setState(() {
        _loadError = null;
        _loadedUrl = null;
      });
      return;
    }

    if (!forceReload &&
        _controller != null &&
        _mountedSessionId == sessionId &&
        url.isNotEmpty &&
        url == _loadedUrl) {
      return;
    }

    if (_controller == null || _mountedSessionId != sessionId) {
      final gen = ++_controllerGen;
      final old = _controller;
      _controller = null;
      unawaited(_mountController(sessionId: sessionId, url: url, gen: gen, disposeOld: old));
      return;
    }

    if (url.isNotEmpty && url != _loadedUrl) {
      unawaited(_loadAgentUrl(url));
    }
  }

  Future<void> _mountController({
    required String sessionId,
    required String url,
    required int gen,
    WebViewController? disposeOld,
  }) async {
    await disposeDesktopWebView(disposeOld);
    if (!mounted || gen != _controllerGen || !_useNativeWebView || !widget.expanded) {
      return;
    }

    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0A0F14))
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (request) {
            if (!_loadingFromAgent && request.url.isNotEmpty) {
              unawaited(_syncUserNavigation(sessionId, request.url));
            }
            return NavigationDecision.navigate;
          },
          onPageFinished: (_) {
            if (!mounted) return;
            _loadingFromAgent = false;
            _refreshNavState();
          },
          onUrlChange: (change) {
            final next = change.url;
            if (next != null &&
                next.isNotEmpty &&
                !_loadingFromAgent &&
                next != _loadedUrl) {
              unawaited(_syncUserNavigation(sessionId, next));
            }
          },
        ),
      );

    if (!mounted || gen != _controllerGen) {
      await disposeDesktopWebView(controller);
      return;
    }

    setState(() {
      _controller = controller;
      _mountedSessionId = sessionId;
      _loadError = null;
    });

    if (url.isNotEmpty) {
      await _loadAgentUrl(url, controller: controller);
    }
  }

  Future<void> _refreshNavState() async {
    final c = _controller;
    if (c == null) return;
    try {
      final back = await c.canGoBack();
      final fwd = await c.canGoForward();
      if (!mounted) return;
      setState(() {
        _canGoBack = back;
        _canGoForward = fwd;
      });
    } catch (_) {}
  }

  bool _isEmbeddableUrl(String url) {
    final lower = url.toLowerCase();
    return lower.startsWith('http://') ||
        lower.startsWith('https://') ||
        lower.startsWith('file://');
  }

  Future<void> _applySessionCookies(String sessionId, String pageUrl) async {
    final port = assetUrlResolver.sidecarPort;
    final token = assetUrlResolver.sidecarToken;
    if (port == null || token == null) return;

    HttpClient? client;
    try {
      client = HttpClient();
      final uri = Uri.parse(
        'http://127.0.0.1:$port/browser/cookies'
        '?token=${Uri.encodeComponent(token)}'
        '&sessionId=${Uri.encodeComponent(sessionId)}',
      );
      final response = await (await client.getUrl(uri)).close();
      if (response.statusCode != 200) return;
      final body = await response.transform(utf8.decoder).join();
      final parsed = jsonDecode(body) as Map<String, dynamic>;
      if (parsed['ok'] != true) return;
      final cookies = parsed['cookies'];
      if (cookies is! List) return;

      Uri? pageUri;
      try {
        pageUri = Uri.parse(pageUrl);
      } catch (_) {
        return;
      }

      for (final raw in cookies) {
        if (raw is! Map) continue;
        final name = raw['name']?.toString() ?? '';
        final value = raw['value']?.toString() ?? '';
        if (name.isEmpty) continue;
        final domain = raw['domain']?.toString();
        final path = raw['path']?.toString() ?? '/';
        await _cookieManager.setCookie(
          WebViewCookie(
            name: name,
            value: value,
            domain: domain?.isNotEmpty == true ? domain! : (pageUri.host.isNotEmpty ? pageUri.host : ''),
            path: path,
          ),
        );
      }
    } catch (_) {
      /* cookie mirror is best-effort */
    } finally {
      client?.close(force: true);
    }
  }

  Future<void> _loadAgentUrl(String url, {WebViewController? controller}) async {
    final c = controller ?? _controller;
    if (c == null || url.isEmpty) return;
    if (!_isEmbeddableUrl(url)) {
      setState(() => _loadError = 'Unsupported URL for in-app browser: $url');
      return;
    }

    _loadingFromAgent = true;
    final sessionId = widget.view.sessionId;
    if (sessionId.isNotEmpty) {
      await _applySessionCookies(sessionId, url);
    }

    try {
      await c.loadRequest(Uri.parse(url));
      if (!mounted) return;
      setState(() {
        _loadedUrl = url;
        _loadError = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingFromAgent = false;
        _loadError = 'Failed to load page';
      });
    }
  }

  Future<void> _syncUserNavigation(String sessionId, String url) async {
    if (url == _loadedUrl || !_isEmbeddableUrl(url)) return;
    final port = assetUrlResolver.sidecarPort;
    final token = assetUrlResolver.sidecarToken;
    if (port == null || token == null) return;

    HttpClient? client;
    try {
      client = HttpClient();
      final uri = Uri.parse(
        'http://127.0.0.1:$port/browser/navigate'
        '?token=${Uri.encodeComponent(token)}'
        '&sessionId=${Uri.encodeComponent(sessionId)}',
      );
      final request = await client.postUrl(uri);
      request.headers.set(HttpHeaders.contentTypeHeader, 'application/json');
      request.add(utf8.encode(jsonEncode({'url': url})));
      final response = await request.close();
      if (response.statusCode == 200) {
        if (mounted) setState(() => _loadedUrl = url);
      }
    } catch (_) {
      /* best-effort sync */
    } finally {
      client?.close(force: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final theme = Theme.of(context);

    return LayoutBuilder(
      builder: (context, constraints) {
        final maxW = constraints.maxWidth;
        final maxH = constraints.maxHeight;
        if (!maxW.isFinite || !maxH.isFinite || maxW <= 0 || maxH <= 0) {
          return const SizedBox.shrink();
        }

        if (!widget.expanded) {
          return SizedBox(
            width: widget.collapsedWidth.clamp(0, maxW),
            height: maxH,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: lim.panel.withValues(alpha: 0.98),
                border: Border(left: BorderSide(color: lim.border)),
              ),
              child: _collapsedRail(context, lim),
            ),
          );
        }

        return DecoratedBox(
          decoration: BoxDecoration(
            color: lim.panel.withValues(alpha: 0.98),
            border: Border(left: BorderSide(color: lim.border)),
          ),
          child: SizedBox(
            width: maxW,
            height: maxH,
            child: _expandedBody(context, lim, theme),
          ),
        );
      },
    );
  }

  Widget _collapsedRail(BuildContext context, LiminalTokens lim) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: widget.onToggleExpanded,
        child: Tooltip(
          message: 'Expand browser',
          child: Center(
            child: RotatedBox(
              quarterTurns: 1,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.language, color: lim.accent, size: 18),
                  const SizedBox(width: 6),
                  Text(
                    'Browser',
                    style: TextStyle(
                      color: lim.accent,
                      fontSize: 11,
                      letterSpacing: 0.6,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _expandedBody(BuildContext context, LiminalTokens lim, ThemeData theme) {
    final view = widget.view;
    final controller = _controller;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Material(
          color: lim.panel.withValues(alpha: 0.95),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: LiminalSpacing.xs,
              vertical: LiminalSpacing.xs,
            ),
            child: Row(
              children: [
                IconButton(
                  tooltip: 'Back',
                  icon: Icon(Icons.arrow_back, color: lim.textMuted, size: 20),
                  onPressed: _canGoBack && controller != null
                      ? () => controller.goBack()
                      : null,
                ),
                IconButton(
                  tooltip: 'Forward',
                  icon: Icon(Icons.arrow_forward, color: lim.textMuted, size: 20),
                  onPressed: _canGoForward && controller != null
                      ? () => controller.goForward()
                      : null,
                ),
                IconButton(
                  tooltip: 'Reload',
                  icon: Icon(Icons.refresh, color: lim.textMuted, size: 20),
                  onPressed: controller != null ? () => controller.reload() : null,
                ),
                const SizedBox(width: LiminalSpacing.xs),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        view.title?.trim().isNotEmpty == true ? view.title! : 'Browser',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleSmall?.copyWith(color: lim.text),
                      ),
                      Text(
                        view.url.isNotEmpty ? view.url : 'Starting…',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall?.copyWith(color: lim.textMuted),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Collapse browser',
                  icon: Icon(Icons.chevron_right, color: lim.textMuted),
                  onPressed: widget.onToggleExpanded,
                ),
              ],
            ),
          ),
        ),
        Divider(height: 1, color: lim.border),
        Expanded(child: _body(context, lim, theme, controller)),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            LiminalSpacing.sm,
            LiminalSpacing.xs,
            LiminalSpacing.sm,
            LiminalSpacing.sm,
          ),
          child: Text(
            'Native browser — scroll, click, and type directly. Agent stays synced on navigation.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: lim.textMuted,
              height: 1.35,
            ),
          ),
        ),
      ],
    );
  }

  Widget _body(
    BuildContext context,
    LiminalTokens lim,
    ThemeData theme,
    WebViewController? controller,
  ) {
    if (_loadError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(LiminalSpacing.md),
          child: Text(
            _loadError!,
            style: TextStyle(color: theme.colorScheme.error),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    if (controller != null && widget.view.url.isNotEmpty) {
      return ClipRRect(
        borderRadius: const BorderRadius.vertical(top: Radius.circular(6)),
        child: DesktopWebViewHost(controller: controller),
      );
    }

    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: LiminalSpacing.sm),
          Text(
            widget.view.sessionId.isEmpty
                ? 'Starting browser session…'
                : 'Loading page…',
            style: theme.textTheme.bodyMedium?.copyWith(color: lim.textMuted),
          ),
        ],
      ),
    );
  }
}

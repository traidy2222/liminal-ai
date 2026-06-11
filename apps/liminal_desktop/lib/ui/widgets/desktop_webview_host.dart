import 'dart:io';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Hosts a native WebView2/WebKitGTK embed and keeps HWND bounds in sync when
/// the Flutter panel moves (window resize, dock rail drag, terminal expand).
///
/// `webview_win_floating` only updates native bounds from its layout wrapper's
/// `performLayout`. Global position can change without a layout pass when
/// ancestor widgets shift — force a subtree relayout on metrics/size changes.
class DesktopWebViewHost extends StatefulWidget {
  const DesktopWebViewHost({
    super.key,
    required this.controller,
    this.backgroundColor = const Color(0xFF0A0F14),
  });

  final WebViewController controller;
  final Color backgroundColor;

  @override
  State<DesktopWebViewHost> createState() => _DesktopWebViewHostState();
}

class _DesktopWebViewHostState extends State<DesktopWebViewHost>
    with WidgetsBindingObserver {
  final GlobalKey _hostKey = GlobalKey(debugLabel: 'desktop_webview_host');
  Size? _lastConstraints;

  static bool get _syncBounds => Platform.isWindows || Platform.isLinux;

  @override
  void initState() {
    super.initState();
    if (_syncBounds) {
      WidgetsBinding.instance.addObserver(this);
    }
  }

  @override
  void dispose() {
    if (_syncBounds) {
      WidgetsBinding.instance.removeObserver(this);
    }
    super.dispose();
  }

  @override
  void didChangeMetrics() {
    _scheduleBoundsRelayout();
  }

  void _scheduleBoundsRelayout() {
    if (!_syncBounds) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _markWebViewLayoutDirty();
    });
  }

  void _markWebViewLayoutDirty() {
    final ro = _hostKey.currentContext?.findRenderObject();
    if (ro == null) return;
    ro.markNeedsLayout();
    ro.visitChildren(_markChildLayoutsDirty);
  }

  void _markChildLayoutsDirty(RenderObject child) {
    child.markNeedsLayout();
    child.visitChildren(_markChildLayoutsDirty);
  }

  void _onConstraintsChanged(Size next) {
    if (!_syncBounds) return;
    if (_lastConstraints != null &&
        _lastConstraints != next &&
        next.width > 0 &&
        next.height > 0) {
      _scheduleBoundsRelayout();
    }
    _lastConstraints = next;
  }

  @override
  Widget build(BuildContext context) {
    if (!_syncBounds) {
      return ColoredBox(
        color: widget.backgroundColor,
        child: WebViewWidget(controller: widget.controller),
      );
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final w = constraints.maxWidth;
        final h = constraints.maxHeight;
        if (!w.isFinite || !h.isFinite || w <= 0 || h <= 0) {
          return const SizedBox.shrink();
        }

        _onConstraintsChanged(Size(w, h));

        return ColoredBox(
          color: widget.backgroundColor,
          child: SizedBox(
            key: _hostKey,
            width: w,
            height: h,
            child: WebViewWidget(controller: widget.controller),
          ),
        );
      },
    );
  }
}

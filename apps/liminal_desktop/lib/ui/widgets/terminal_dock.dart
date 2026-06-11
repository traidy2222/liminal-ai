import 'dart:async';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../models/terminal_panel_state.dart';
import 'desktop_webview_lifecycle.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import 'panel_resize_handle.dart';

/// In-chat Ghostty terminal below the composer (sidecar PTY embed over loopback WebView).
class TerminalDock extends StatefulWidget {
  const TerminalDock({
    super.key,
    required this.panel,
    required this.expanded,
    required this.onToggleExpanded,
    required this.bodyHeight,
    this.onResizeBodyHeight,
    this.onSelectTab,
    this.onCloseTab,
    this.onNewTab,
    this.collapsedHeight = 36,
  });

  final TerminalPanelState panel;
  final bool expanded;
  final VoidCallback onToggleExpanded;
  final double bodyHeight;
  final ValueChanged<double>? onResizeBodyHeight;
  final ValueChanged<String>? onSelectTab;
  final ValueChanged<String>? onCloseTab;
  final VoidCallback? onNewTab;
  final double collapsedHeight;

  @override
  State<TerminalDock> createState() => _TerminalDockState();
}

class _TerminalDockState extends State<TerminalDock> {
  WebViewController? _controller;
  String? _loadedSessionId;
  Size? _lastNotifiedSize;
  int _controllerGen = 0;

  @override
  void initState() {
    super.initState();
    _syncController();
  }

  @override
  void dispose() {
    final controller = _controller;
    _controller = null;
    unawaited(disposeDesktopWebView(controller));
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant TerminalDock oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.panel.activeSessionId != widget.panel.activeSessionId ||
        oldWidget.bodyHeight != widget.bodyHeight) {
      _lastNotifiedSize = null;
    }
    _syncController();
  }

  void _syncController() {
    final tab = widget.panel.activeTab;
    if (tab == null) return;
    if (_loadedSessionId == tab.sessionId && _controller != null) return;
    _loadedSessionId = tab.sessionId;
    final gen = ++_controllerGen;
    final old = _controller;
    _controller = null;
    unawaited(_mountController(tab, gen: gen, disposeOld: old));
  }

  Future<void> _mountController(
    TerminalTabState tab, {
    required int gen,
    WebViewController? disposeOld,
  }) async {
    await disposeDesktopWebView(disposeOld);
    if (!mounted || gen != _controllerGen || _loadedSessionId != tab.sessionId) {
      return;
    }
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0A0F14))
      ..loadRequest(Uri.parse(tab.embedUrl));
    if (!mounted || gen != _controllerGen || _loadedSessionId != tab.sessionId) {
      await disposeDesktopWebView(controller);
      return;
    }
    setState(() => _controller = controller);
  }

  void _notifyTerminalFit(Size size) {
    if (!widget.expanded) return;
    if (_lastNotifiedSize == size) return;
    _lastNotifiedSize = size;
    final controller = _controller;
    if (controller == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      controller.runJavaScript(
        'window.__liminalTerminalFit && window.__liminalTerminalFit()',
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final bodyHeight = widget.bodyHeight;
    final panelHeight =
        widget.expanded ? bodyHeight + widget.collapsedHeight + 28 : widget.collapsedHeight;
    final active = widget.panel.activeTab;

    return LayoutBuilder(
      builder: (context, constraints) {
        final w = constraints.maxWidth.isFinite ? constraints.maxWidth : 0.0;
        if (w > 0 && panelHeight > 0) {
          _notifyTerminalFit(Size(w, panelHeight));
        }

        return AnimatedContainer(
          duration: widget.expanded
              ? Duration.zero
              : const Duration(milliseconds: 180),
          height: panelHeight,
          width: constraints.maxWidth.isFinite ? constraints.maxWidth : null,
          decoration: BoxDecoration(
            color: lim.panel.withValues(alpha: 0.92),
            border: Border(top: BorderSide(color: lim.borderStrong)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.expanded && widget.onResizeBodyHeight != null)
                PanelResizeHandle(
                  axis: PanelResizeAxis.vertical,
                  onDragDelta: widget.onResizeBodyHeight!,
                ),
              SizedBox(
                height: widget.collapsedHeight,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: LiminalSpacing.sm),
                  child: Row(
                    children: [
                      InkWell(
                        onTap: widget.onToggleExpanded,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              widget.expanded ? Icons.expand_more : Icons.terminal,
                              size: 18,
                              color: lim.success,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              'Terminal',
                              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                    color: lim.success,
                                  ),
                            ),
                            if (widget.panel.tabs.length > 1)
                              Padding(
                                padding: const EdgeInsets.only(left: 4),
                                child: Text(
                                  '${widget.panel.tabs.length}',
                                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                        color: lim.textMuted,
                                        fontSize: 10,
                                      ),
                                ),
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(
                            children: [
                              for (final tab in widget.panel.tabs)
                                _TabChip(
                                  label: tab.label,
                                  source: tab.source,
                                  selected: tab.sessionId == widget.panel.activeSessionId,
                                  onTap: () => widget.onSelectTab?.call(tab.sessionId),
                                  onClose: () => widget.onCloseTab?.call(tab.sessionId),
                                ),
                            ],
                          ),
                        ),
                      ),
                      if (widget.onNewTab != null)
                        IconButton(
                          icon: const Icon(Icons.add, size: 18),
                          tooltip: 'New terminal tab',
                          color: lim.success,
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
                          onPressed: widget.onNewTab,
                        ),
                    ],
                  ),
                ),
              ),
              if (widget.expanded && active != null) ...[
                if (active.cwd.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      LiminalSpacing.sm,
                      0,
                      LiminalSpacing.sm,
                      4,
                    ),
                    child: Text(
                      active.cwd,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: lim.textMuted,
                            fontSize: 10,
                            fontFamily: 'Consolas',
                          ),
                    ),
                  ),
                SizedBox(
                  height: bodyHeight,
                  child: ClipRRect(
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(6)),
                    child: _controller == null
                        ? ColoredBox(
                            color: const Color(0xFF0A0F14),
                            child: Center(
                              child: Text(
                                'Starting shell…',
                                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                      color: lim.textMuted,
                                    ),
                              ),
                            ),
                          )
                        : WebViewWidget(
                            key: ValueKey(active.sessionId),
                            controller: _controller!,
                          ),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _TabChip extends StatelessWidget {
  const _TabChip({
    required this.label,
    required this.source,
    required this.selected,
    required this.onTap,
    required this.onClose,
  });

  final String label;
  final String source;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback onClose;

  bool get _isAgentShell => source == 'agent' && label == 'Agent shell';

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final accent = _isAgentShell
        ? lim.success
        : (source == 'agent' ? const Color(0xFFE6B84D) : lim.textMuted);
    final icon = _isAgentShell
        ? Icons.smart_toy_outlined
        : (source == 'agent' ? Icons.play_circle_outline : Icons.terminal);

    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: Material(
        color: selected ? accent.withValues(alpha: 0.14) : Colors.transparent,
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(6),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              border: Border.all(
                color: selected ? accent.withValues(alpha: 0.55) : lim.border.withValues(alpha: 0.35),
              ),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 13, color: accent),
                const SizedBox(width: 6),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 200),
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          fontSize: 11,
                          fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                          color: selected ? lim.text : lim.textMuted,
                        ),
                  ),
                ),
                const SizedBox(width: 6),
                GestureDetector(
                  onTap: onClose,
                  child: Icon(Icons.close, size: 13, color: lim.textMuted),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

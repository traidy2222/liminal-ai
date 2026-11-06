import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../browser/browser_workspace.dart';
import '../rich_message/asset_url_resolver.dart';
import 'desktop_webview_host.dart';

class BrowserWorkspaceStrip extends StatelessWidget {
  const BrowserWorkspaceStrip({super.key});
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: BrowserWorkspace.instance,
    builder: (context, _) {
      final workspace = BrowserWorkspace.instance;
      return Align(
        alignment: Alignment.centerRight,
        child: TextButton.icon(
          icon: const Icon(Icons.language, size: 17),
          label: Text(
            workspace.tabs.isEmpty
                ? 'Browser'
                : 'Browser · ${workspace.tabs.length} tabs',
          ),
          onPressed: workspace.togglePanel,
        ),
      );
    },
  );
}

/// Displays the exact app-owned controller to which agent Playwright is attached.
class BrowserDock extends StatefulWidget {
  const BrowserDock({super.key});
  @override
  State<BrowserDock> createState() => _BrowserDockState();
}

class _BrowserDockState extends State<BrowserDock> {
  final _address = TextEditingController();
  final _addressFocus = FocusNode();
  final _workspace = BrowserWorkspace.instance;
  String? _visibleId;
  String? _visibleChatId;
  @override
  void initState() {
    super.initState();
    _workspace.addListener(_changed);
    _changed();
  }

  void _changed() {
    if (_visibleChatId != _workspace.activeChatId) {
      _visibleChatId = _workspace.activeChatId;
      _addressFocus.unfocus();
    }
    final next = _workspace.selectedTabId;
    if (_visibleId != next) {
      if (_visibleId != null) {
        unawaited(_workspace.setVisible(_visibleId!, false));
      }
      _visibleId = next;
      if (next != null) unawaited(_workspace.setVisible(next, true));
    }
    final tab = _workspace.tabs
        .where((t) => t['sessionId'] == next)
        .firstOrNull;
    if (!_addressFocus.hasFocus) _address.text = tab?['url'] as String? ?? '';
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _workspace.removeListener(_changed);
    if (_visibleId != null) {
      unawaited(_workspace.setVisible(_visibleId!, false));
    }
    _address.dispose();
    _addressFocus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final id = _workspace.selectedTabId;
    final tab = _workspace.tabs.where((t) => t['sessionId'] == id).firstOrNull;
    final controller = id == null ? null : _workspace.controllerFor(id);
    final paused = tab?['paused'] == true;
    return Material(
      color: Theme.of(context).colorScheme.surface,
      child: Column(
        children: [
          SizedBox(
            height: 42,
            child: Row(
              children: [
                Expanded(
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    children: [
                      for (final t in _workspace.tabs)
                        Padding(
                          padding: const EdgeInsets.all(3),
                          child: InputChip(
                            selected: t['sessionId'] == id,
                            label: SizedBox(
                              width: 120,
                              child: Text(
                                t['title'] as String? ?? 'New tab',
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            onPressed: () =>
                                _workspace.selectTab(t['sessionId'] as String),
                            onDeleted: () => _workspace.command(
                              'close',
                              tabId: t['sessionId'] as String,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'New tab',
                  onPressed: () => _workspace.command('open'),
                  icon: const Icon(Icons.add, size: 19),
                ),
                IconButton(
                  tooltip: 'Hide browser',
                  onPressed: _workspace.togglePanel,
                  icon: const Icon(Icons.close, size: 19),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6),
            child: Row(
              children: [
                for (final entry in [
                  ('back', Icons.arrow_back),
                  ('forward', Icons.arrow_forward),
                  ('reload', Icons.refresh),
                ])
                  IconButton(
                    tooltip: entry.$1,
                    visualDensity: VisualDensity.compact,
                    onPressed: id == null
                        ? null
                        : () => _workspace.command(entry.$1, tabId: id),
                    icon: Icon(entry.$2, size: 18),
                  ),
                Expanded(
                  child: TextField(
                    controller: _address,
                    focusNode: _addressFocus,
                    decoration: const InputDecoration(
                      isDense: true,
                      hintText: 'Search or enter address',
                      border: OutlineInputBorder(),
                    ),
                    onSubmitted: (value) {
                      final raw = value.trim();
                      if (raw.isEmpty) return;
                      final url = raw.contains('://')
                          ? raw
                          : raw.contains('.') && !raw.contains(' ')
                          ? 'https://$raw'
                          : 'https://www.google.com/search?q=${Uri.encodeComponent(raw)}';
                      _addressFocus.unfocus();
                      unawaited(
                        _workspace.command(
                          id == null ? 'open' : 'navigate',
                          tabId: id,
                          url: url,
                        ),
                      );
                    },
                  ),
                ),
                PopupMenuButton<String>(
                  tooltip: 'Browser settings',
                  onOpened: () {
                    if (id != null) unawaited(_workspace.setVisible(id, false));
                  },
                  onCanceled: () {
                    if (id != null) unawaited(_workspace.setVisible(id, true));
                  },
                  onSelected: (value) async {
                    if (value == 'history') {
                      if (id != null) await _workspace.setVisible(id, false);
                      if (!context.mounted) return;
                      await showModalBottomSheet<void>(
                        context: context,
                        builder: (context) => ListView(
                          children: [
                            const ListTile(title: Text('Browser history')),
                            for (final h in _workspace.history.reversed)
                              ListTile(
                                title: Text(h['title'] as String? ?? ''),
                                subtitle: Text(h['url'] as String),
                                onTap: () {
                                  Navigator.pop(context);
                                  unawaited(
                                    _workspace.command(
                                      id == null ? 'open' : 'navigate',
                                      tabId: id,
                                      url: h['url'] as String,
                                    ),
                                  );
                                },
                              ),
                          ],
                        ),
                      );
                      if (id != null && mounted) {
                        await _workspace.setVisible(id, true);
                      }
                    } else {
                      await _workspace.command(value, tabId: id);
                      if (id != null && mounted) {
                        await _workspace.setVisible(id, true);
                      }
                    }
                  },
                  itemBuilder: (_) => [
                    const PopupMenuItem(
                      value: 'history',
                      child: Text('Browsing history'),
                    ),
                    const PopupMenuItem(
                      value: 'clear_history',
                      child: Text('Clear history'),
                    ),
                    if (id != null)
                      const PopupMenuItem(
                        value: 'clear_site_data',
                        child: Text('Clear this site’s saved data'),
                      ),
                  ],
                ),
              ],
            ),
          ),
          if (id != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10),
              child: Row(
                children: [
                  Icon(
                    paused ? Icons.pan_tool_outlined : Icons.auto_awesome,
                    size: 14,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      paused ? 'You have control' : 'Shared with your agent',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                  TextButton(
                    onPressed: () => _workspace.command(
                      paused ? 'resume' : 'pause',
                      tabId: id,
                    ),
                    child: Text(paused ? 'Resume agent' : 'Take control'),
                  ),
                ],
              ),
            ),
          if (_workspace.error != null)
            Padding(
              padding: const EdgeInsets.all(8),
              child: Text(
                _workspace.error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          const Divider(height: 1),
          Expanded(
            child: controller != null
                ? DesktopWebViewHost(key: ValueKey(id), controller: controller)
                : tab?['suspended'] == true
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.bedtime_outlined),
                        const SizedBox(height: 12),
                        const Text('Sleeping tab — page loads when needed'),
                        TextButton(
                          onPressed: () =>
                              _workspace.command('focus', tabId: id),
                          child: const Text('Load this tab'),
                        ),
                      ],
                    ),
                  )
                : id != null
                ? SharedBrowserStream(key: ValueKey(id), sessionId: id)
                : Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.language, size: 44),
                        const SizedBox(height: 12),
                        const Text('Your Liminal browser'),
                        const SizedBox(height: 8),
                        const Text('Sign in once. Continue with your agent.'),
                        TextButton.icon(
                          onPressed: () => _workspace.command('open'),
                          icon: const Icon(Icons.add),
                          label: const Text('Open a tab'),
                        ),
                      ],
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

/// Non-Windows fallback streams and controls the same persistent Chromium page.
class SharedBrowserStream extends StatefulWidget {
  const SharedBrowserStream({super.key, required this.sessionId});
  final String sessionId;
  @override
  State<SharedBrowserStream> createState() => _SharedBrowserStreamState();
}

class _SharedBrowserStreamState extends State<SharedBrowserStream> {
  WebSocket? _socket;
  Uint8List? _frame;
  final _focus = FocusNode();
  double _width = 1280, _height = 800;
  String? _error;
  @override
  void initState() {
    super.initState();
    unawaited(_connect());
  }

  Future<void> _connect() async {
    try {
      final url = assetUrlResolver.resolveBrowserStream(widget.sessionId);
      if (url == null) throw StateError('Liminal is connecting');
      final socket = await WebSocket.connect(url);
      if (!mounted) {
        await socket.close();
        return;
      }
      _socket = socket;
      socket.listen(
        (data) {
          if (!mounted) return;
          if (data is List<int>) {
            setState(() => _frame = Uint8List.fromList(data));
          } else if (data is String) {
            final meta = jsonDecode(data) as Map<String, dynamic>;
            _width = (meta['viewportWidth'] as num?)?.toDouble() ?? _width;
            _height = (meta['viewportHeight'] as num?)?.toDouble() ?? _height;
          }
        },
        onError: (Object _) {
          if (mounted) {
            setState(() => _error = 'Browser connection interrupted');
          }
        },
        onDone: () {
          if (mounted) {
            setState(
              () => _error =
                  'Browser disconnected. Reopen the panel to reconnect.',
            );
          }
        },
      );
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  void _send(Map<String, dynamic> input) => _socket?.add(jsonEncode(input));
  @override
  void dispose() {
    unawaited(_socket?.close());
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final scale = (constraints.maxWidth / _width).clamp(
        0.01,
        constraints.maxHeight / _height,
      );
      final left = (constraints.maxWidth - _width * scale) / 2,
          top = (constraints.maxHeight - _height * scale) / 2;
      Map<String, dynamic>? position(Offset local) {
        final x = (local.dx - left) / scale, y = (local.dy - top) / scale;
        return x >= 0 && y >= 0 && x < _width && y < _height
            ? {'x': x, 'y': y}
            : null;
      }

      return Focus(
        focusNode: _focus,
        onKeyEvent: (_, event) {
          if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
            return KeyEventResult.handled;
          }
          final key = event.logicalKey;
          final names = {
            LogicalKeyboardKey.enter: 'Enter',
            LogicalKeyboardKey.backspace: 'Backspace',
            LogicalKeyboardKey.tab: 'Tab',
            LogicalKeyboardKey.escape: 'Escape',
            LogicalKeyboardKey.arrowUp: 'ArrowUp',
            LogicalKeyboardKey.arrowDown: 'ArrowDown',
            LogicalKeyboardKey.arrowLeft: 'ArrowLeft',
            LogicalKeyboardKey.arrowRight: 'ArrowRight',
          };
          if (names.containsKey(key)) {
            _send({'type': 'keydown', 'key': names[key]});
          } else if (event.character?.isNotEmpty == true) {
            _send({'type': 'type', 'text': event.character});
          }
          return KeyEventResult.handled;
        },
        child: Listener(
          onPointerDown: (event) {
            _focus.requestFocus();
            final point = position(event.localPosition);
            if (point != null) _send({'type': 'click', ...point});
          },
          onPointerSignal: (event) {
            if (event is PointerScrollEvent) {
              final point = position(event.localPosition);
              if (point != null) {
                _send({
                  'type': 'wheel',
                  ...point,
                  'deltaX': event.scrollDelta.dx,
                  'deltaY': event.scrollDelta.dy,
                });
              }
            }
          },
          child: ColoredBox(
            color: Colors.black,
            child: SizedBox.expand(
              child: _error != null
                  ? Center(child: Text(_error!))
                  : _frame == null
                  ? const Center(child: CircularProgressIndicator())
                  : Image.memory(
                      _frame!,
                      fit: BoxFit.contain,
                      gaplessPlayback: true,
                    ),
            ),
          ),
        ),
      );
    },
  );
}

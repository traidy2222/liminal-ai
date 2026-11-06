import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_win_floating/webview_plugin.dart';
import '../ui/rich_message/asset_url_resolver.dart';
import '../ui/widgets/desktop_webview_lifecycle.dart';
import 'browser_chat_tabs.dart';
import 'native_tab_creation.dart';

/// Owns native tabs independently of widgets/chats. Sidecar attaches to these exact pages.
class BrowserWorkspace extends ChangeNotifier {
  static final instance = BrowserWorkspace();
  final Map<String, WebViewController> _controllers = {};
  final Map<String, bool> _visibility = {};
  final Set<String> _knownControllerTabs = {};
  String? _lastState;
  final String _clientId =
      '${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 30)}';
  int? _debugPort;
  bool _started = false;
  bool _disposed = false;
  int? _connectedPort;
  final _tabState = BrowserChatTabs();
  final Map<String, bool> _panels = {};
  final Set<String> _restoredChats = {};
  List<Map<String, dynamic>> get tabs => _tabState.tabs;
  String? get activeChatId => _tabState.activeChatId;
  List<Map<String, dynamic>> history = [];
  String? get selectedTabId => _tabState.selectedTabId;
  String? error;
  String? profilePath;
  bool get showPanel => _panels[_tabState.activeChatId] ?? false;
  set showPanel(bool value) {
    final chat = _tabState.activeChatId;
    if (chat != null) _panels[chat] = value;
  }

  Timer? _refreshTimer;
  bool _refreshing = false;
  int _refreshIssued = 0;
  int _refreshApplied = 0;
  bool _browserReady = false;
  bool get nativeAvailable => _debugPort != null;
  WebViewController? controllerFor(String id) => _controllers[id];

  void setActiveChat(String? chatId) {
    if (_tabState.activeChatId == chatId) return;
    _tabState.activeChatId = chatId;
    notifyListeners();
    if (chatId != null && _browserReady) {
      unawaited(_restoreChat(chatId));
    }
  }

  Future<void> _restoreChat(String chatId) async {
    if (!_browserReady) return;
    if (!_restoredChats.add(chatId)) return;
    try {
      await _post('control', {'action': 'restore', 'chatId': chatId});
      await refresh();
    } catch (_) {
      _restoredChats.remove(chatId);
    }
  }

  Future<void> initialize() async {
    if (_started) return;
    _started = true;
    if (Platform.isWindows &&
        Platform.environment['LIMINAL_BROWSER_NATIVE'] != '0') {
      try {
        final socket = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
        final port = socket.port;
        await socket.close();
        final home =
            Platform.environment['LOCALAPPDATA'] ??
            p.join(Platform.environment['USERPROFILE']!, 'AppData', 'Local');
        final root =
            Platform.environment['LIMINAL_BROWSER_DATA_DIR'] ??
            p.join(home, 'Liminal', 'Browser');
        final folder = p.join(root, 'profiles', 'default', 'webview2');
        await Directory(folder).create(recursive: true);
        await const MethodChannel('liminal/remote_desktop').invokeMethod<void>(
          'configureBrowser',
          {'port': port, 'folder': folder},
        );
        _debugPort = port;
      } on MissingPluginException {
        /* Non-native test hosts use the shared stream. */
      } catch (e) {
        _debugPort = null;
        error =
            'Native browser setup unavailable; using the shared browser: $e';
      }
    }
    assetUrlResolver.addListener(_onConnection);
    _onConnection();
    _refreshTimer = Timer.periodic(const Duration(seconds: 10), (_) {
      if (_connectedPort != null && !_refreshing) {
        _refreshing = true;
        unawaited(
          refresh()
              .catchError((Object _) {})
              .whenComplete(() => _refreshing = false),
        );
      }
    });
  }

  void _onConnection() {
    final port = assetUrlResolver.sidecarPort;
    if (port == null || port == _connectedPort || _disposed) return;
    _connectedPort = port;
    _browserReady = false;
    _restoredChats.clear();
    unawaited(_connect(port));
  }

  Future<void> _connect(int port) async {
    final stale = _controllers.values.toList();
    _controllers.clear();
    _knownControllerTabs.clear();
    _visibility.clear();
    _lastState = null;
    await Future.wait(stale.map(disposeDesktopWebView));
    if (!_disposed && assetUrlResolver.sidecarPort == port) await _run(port);
  }

  Future<Map<String, dynamic>> _post(
    String route,
    Map<String, dynamic> body,
  ) async {
    final port = assetUrlResolver.sidecarPort;
    final token = assetUrlResolver.sidecarToken;
    if (port == null || token == null) {
      throw StateError('Liminal is connecting');
    }
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 5);
    try {
      final request = await client.postUrl(
        Uri.parse('http://127.0.0.1:$port/browser/$route'),
      );
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      request.headers.contentType = ContentType.json;
      request.write(jsonEncode(body));
      final response = await request.close().timeout(
        const Duration(seconds: 45),
      );
      final raw = await response.transform(utf8.decoder).join();
      final result = jsonDecode(raw) as Map<String, dynamic>;
      if (result['ok'] != true) {
        throw StateError(
          result['error']?.toString() ?? 'Browser request failed',
        );
      }
      return result;
    } finally {
      client.close(force: true);
    }
  }

  Future<void> _run(int port) async {
    var registered = false;
    var restored = false;
    while (!_disposed && assetUrlResolver.sidecarPort == port) {
      try {
        if (_debugPort != null && !registered) {
          await _post('desktop', {
            'action': 'register',
            'clientId': _clientId,
            'port': _debugPort,
          });
          registered = true;
        }
        if (!restored) {
          _browserReady = true;
          // Restoration requests native tabs, so it must run alongside the command poll.
          restored = true;
          unawaited(
            command('restore').catchError((Object e) {
              error = '$e';
              notifyListeners();
            }),
          );
        }
        if (_debugPort == null) {
          await refresh();
          await Future<void>.delayed(const Duration(seconds: 2));
          continue;
        }
        final result = await _post('desktop', {
          'action': 'poll',
          'clientId': _clientId,
        });
        final raw = result['command'];
        if (raw is Map) await _execute(Map<String, dynamic>.from(raw));
        await refresh();
        final active = _tabState.activeChatId;
        if (active != null) unawaited(_restoreChat(active));
        error = null;
      } catch (e) {
        error = '$e';
        registered = false;
        notifyListeners();
        await Future<void>.delayed(const Duration(seconds: 2));
      }
    }
    if (_connectedPort == port) _connectedPort = null;
  }

  Future<void> _execute(Map<String, dynamic> request) async {
    final id = request['tabId'] as String;
    String? failure;
    try {
      if (request['action'] == 'close') {
        _knownControllerTabs.remove(id);
        _visibility.remove(id);
        await disposeDesktopWebView(_controllers.remove(id));
      } else if (!_controllers.containsKey(id)) {
        final home =
            Platform.environment['LOCALAPPDATA'] ??
            p.join(Platform.environment['USERPROFILE']!, 'AppData', 'Local');
        final root =
            Platform.environment['LIMINAL_BROWSER_DATA_DIR'] ??
            p.join(home, 'Liminal', 'Browser');
        final directory = p.join(root, 'profiles', 'default', 'webview2');
        await Directory(directory).create(recursive: true);
        final controller = await createNativeBrowserTab(() async {
          final controller = WebViewController.fromPlatformCreationParams(
            WindowsWebViewControllerCreationParams(
              userDataFolder: directory,
              profileName: 'LiminalBrowser',
              suspendDuringDeactive: false,
            ),
          );
          try {
            await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
            await controller.loadRequest(
              Uri.parse('about:blank#liminal-tab=$id'),
            );
            final platform =
                controller.platform as WindowsPlatformWebViewController;
            await platform.controller.setVisibility(false);
            return controller;
          } catch (_) {
            await disposeDesktopWebView(controller);
            rethrow;
          }
        });
        _controllers[id] = controller;
      }
    } catch (e) {
      failure = '$e';
      await disposeDesktopWebView(_controllers.remove(id));
    }
    notifyListeners();
    await _post('desktop', {
      'action': 'complete',
      'clientId': _clientId,
      'id': request['id'],
      if (failure != null) 'error': failure,
    });
  }

  Future<void> command(String action, {String? tabId, String? url}) async {
    final chatId = _tabState.activeChatId;
    if (action != 'restore' && chatId == null) {
      error = 'Select a chat to browse';
      notifyListeners();
      return;
    }
    try {
      final result = await _post('control', {
        'action': action,
        if (tabId != null) 'sessionId': tabId,
        if (url != null) 'url': url,
        if (chatId != null) 'chatId': chatId,
      });
      await refresh();
      if (chatId != null && action == 'open' && result['sessionId'] is String) {
        _tabState.select(chatId, result['sessionId'] as String);
      }
      if (chatId != null && action == 'focus' && tabId != null) {
        _tabState.select(chatId, tabId);
      }
      error = null;
      notifyListeners();
    } catch (e) {
      error = '$e';
      notifyListeners();
    }
  }

  Future<void> refresh() async {
    final generation = ++_refreshIssued;
    final port = assetUrlResolver.sidecarPort;
    final state = await _post('control', {'action': 'state'});
    if (_disposed ||
        port != assetUrlResolver.sidecarPort ||
        generation < _refreshApplied)
      return;
    _refreshApplied = generation;
    _apply(state);
  }

  void _apply(Map<String, dynamic> state) {
    final fingerprint = jsonEncode(state);
    if (fingerprint == _lastState) return;
    _lastState = fingerprint;
    final ids = (state['tabs'] as List? ?? [])
        .whereType<Map>()
        .where((t) => t['suspended'] != true)
        .map((t) => t['sessionId'])
        .toSet();
    for (final id in _controllers.keys.toList()) {
      if (ids.contains(id)) {
        _knownControllerTabs.add(id);
      } else if (_knownControllerTabs.remove(id)) {
        unawaited(disposeDesktopWebView(_controllers.remove(id)));
        _visibility.remove(id);
      }
    }
    final previous = tabs.map((tab) => tab['sessionId']).toSet();
    _tabState.apply(state);
    if (tabs.any(
      (tab) => tab['suspended'] != true && !previous.contains(tab['sessionId']),
    )) {
      showPanel = true;
    }
    history = (state['history'] as List? ?? [])
        .map((t) => Map<String, dynamic>.from(t as Map))
        .toList();
    profilePath = state['profilePath'] as String?;
    notifyListeners();
  }

  Future<void> setVisible(String id, bool visible) async {
    if (visible && !tabs.any((tab) => tab['sessionId'] == id)) return;
    if (_visibility[id] == visible) return;
    _visibility[id] = visible;
    try {
      await _post('control', {
        'action': visible ? 'show' : 'hide',
        'sessionId': id,
        if (_tabState.activeChatId != null && visible)
          'chatId': _tabState.activeChatId,
      });
    } catch (e) {
      if (visible) {
        _visibility.remove(id);
        error = '$e';
        notifyListeners();
        return;
      }
    }
    if (_visibility[id] != visible) return;
    final platform = _controllers[id]?.platform;
    if (platform is WindowsPlatformWebViewController) {
      await platform.controller.setVisibility(visible);
    }
    if (visible) await refresh();
  }

  void togglePanel() {
    showPanel = !showPanel;
    notifyListeners();
  }

  void selectTab(String id) {
    final chatId = _tabState.activeChatId;
    if (chatId == null) return;
    _tabState.select(chatId, id);
    notifyListeners();
    unawaited(command('focus', tabId: id));
  }

  @override
  void dispose() {
    _disposed = true;
    _refreshTimer?.cancel();
    assetUrlResolver.removeListener(_onConnection);
    for (final c in _controllers.values) {
      unawaited(disposeDesktopWebView(c));
    }
    _controllers.clear();
    super.dispose();
  }
}

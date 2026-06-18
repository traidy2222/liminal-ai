import 'dart:async';

import '../protocol/frames.dart';
import '../transport/ws_transport.dart';

/// Loopback WebSocket client with command helpers and global/chat frame routing.
class ProtocolClient {
  WsTransport? _transport;
  StreamSubscription<ServerFrame>? _subscription;
  Completer<void>? _readyCompleter;

  void Function(ServerFrame frame)? onGlobalFrame;
  void Function(String chatId, String event, Map<String, dynamic> data)?
      onChatFrame;

  /// Called when the transport socket drops (sleep, sidecar restart, etc.).
  void Function(String reason)? onConnectionLost;

  int protocolVersion = 1;
  String sidecarVersion = '';

  /// True when a transport exists (may still be a dead socket — prefer [isLive]).
  bool get isConnected => _transport != null;

  /// True when the WebSocket is open and accepting commands.
  bool get isLive => _transport?.isLive ?? false;

  Future<void> connect({required int port, required String token}) async {
    await _closeTransport();
    _readyCompleter = Completer<void>();
    _transport = WsTransport(
      port: port,
      token: token,
      onDisconnect: _handleTransportDisconnect,
    );
    _subscription = _transport!.frames.listen(_dispatchFrame);
    await _transport!.connect();
  }

  /// Re-open the WebSocket after a drop without tearing down frame routing.
  Future<void> reconnect({required int port, required String token}) async {
    await _transport?.closeSocket();
    _readyCompleter = Completer<void>();
    if (_transport == null ||
        _transport!.port != port ||
        _transport!.token != token) {
      await _subscription?.cancel();
      _transport = WsTransport(
        port: port,
        token: token,
        onDisconnect: _handleTransportDisconnect,
      );
      _subscription = _transport!.frames.listen(_dispatchFrame);
    }
    await _transport!.connect();
  }

  void _handleTransportDisconnect(String reason) {
    onConnectionLost?.call(reason);
  }

  /// Waits until the sidecar finishes harness registration (`sidecar_ready`).
  /// Do not treat the initial `hello` with `starting: true` as ready.
  Future<void> waitForSidecarReady({
    Duration timeout = const Duration(seconds: 120),
  }) {
    final completer = _readyCompleter;
    if (completer == null) {
      return Future.error(StateError('ProtocolClient.connect was not called'));
    }
    if (completer.isCompleted) return Future.value();
    return completer.future.timeout(
      timeout,
      onTimeout: () => throw TimeoutException(
        'Sidecar did not finish starting within ${timeout.inSeconds}s '
        '(tool registration may still be running).',
      ),
    );
  }

  @Deprecated('Use waitForSidecarReady')
  Future<void> waitForHello({Duration timeout = const Duration(seconds: 120)}) =>
      waitForSidecarReady(timeout: timeout);

  void _dispatchFrame(ServerFrame frame) {
    switch (frame.event) {
      case 'hello':
        protocolVersion = (frame.data['protocolVersion'] as num?)?.toInt() ?? 1;
        sidecarVersion = frame.data['sidecarVersion'] as String? ?? '';
        final starting = frame.data['starting'] as bool? ?? false;
        if (!starting) {
          _completeReady();
        }
        try {
          onGlobalFrame?.call(frame);
        } catch (_) {
          /* AppController handles malformed payloads */
        }
        return;
      case 'sidecar_ready':
        _completeReady();
        try {
          onGlobalFrame?.call(frame);
        } catch (e, st) {
          assert(() {
            // ignore: avoid_print
            print('Protocol global frame error ($e): $st');
            return true;
          }());
        }
        return;
      case 'chat_list':
      case 'settings':
      case 'vireon_account':
      case 'pong':
      case 'app_list':
      case 'app_spawned':
      case 'app_updated':
      case 'app_closed':
      case 'app_data':
      case 'orchestration_status':
      case 'pty_opened':
      case 'pty_exit':
      case 'remote_session':
      case 'remote_ui_input':
      case 'remote_ui_meta':
        onGlobalFrame?.call(frame);
        return;
      default:
        final chatId = frame.chatId;
        if (chatId == null) return;
        onChatFrame?.call(chatId, frame.event, frame.data);
    }
  }

  Future<CommandResult> send(
    String command,
    Map<String, dynamic> data, {
    Duration timeout = const Duration(seconds: 120),
  }) async {
    final transport = _transport;
    if (transport == null || !transport.isLive) {
      return CommandResult(ok: false, error: 'Not connected');
    }
    return transport.sendCommand(command, data, timeout: timeout);
  }

  Future<bool> ping({Duration timeout = const Duration(seconds: 5)}) async {
    final result = await send('ping', {}, timeout: timeout);
    return result.ok;
  }

  void _completeReady() {
    final completer = _readyCompleter;
    if (completer != null && !completer.isCompleted) {
      completer.complete();
    }
  }

  Future<void> disconnect() async {
    await _closeTransport();
    _readyCompleter = null;
  }

  Future<void> _closeTransport() async {
    await _subscription?.cancel();
    _subscription = null;
    await _transport?.dispose();
    _transport = null;
  }
}

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

  int protocolVersion = 1;
  String sidecarVersion = '';

  bool get isConnected => _transport != null;

  Future<void> connect({required int port, required String token}) async {
    await disconnect();
    _readyCompleter = Completer<void>();
    _transport = WsTransport(port: port, token: token);
    _subscription = _transport!.frames.listen(_dispatchFrame);
    await _transport!.connect();
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
        onGlobalFrame?.call(frame);
        return;
      case 'sidecar_ready':
        _completeReady();
      case 'chat_list':
      case 'settings':
      case 'vireon_account':
      case 'pong':
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
    if (transport == null) {
      return CommandResult(ok: false, error: 'Not connected');
    }
    return transport.sendCommand(command, data, timeout: timeout);
  }

  void _completeReady() {
    final completer = _readyCompleter;
    if (completer != null && !completer.isCompleted) {
      completer.complete();
    }
  }

  Future<void> disconnect() async {
    await _subscription?.cancel();
    _subscription = null;
    await _transport?.dispose();
    _transport = null;
    _readyCompleter = null;
  }
}

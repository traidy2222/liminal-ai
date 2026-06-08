import 'dart:async';

import 'package:web_socket_channel/web_socket_channel.dart';

import '../protocol/frames.dart';

/// Result of a command round-trip (`command_result` event).
class CommandResult {
  CommandResult({
    required this.ok,
    this.error,
    this.data,
  });

  final bool ok;
  final String? error;
  final Object? data;
}

/// Token-gated loopback WebSocket client for `liminald`.
class WsTransport {
  WsTransport({
    required this.port,
    required this.token,
  });

  final int port;
  final String token;

  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  final _frameController = StreamController<ServerFrame>.broadcast();
  final _pending = <String, Completer<CommandResult>>{};
  int _cmdSeq = 0;
  bool _disposed = false;

  Stream<ServerFrame> get frames => _frameController.stream;

  Future<void> connect() async {
    if (_channel != null) return;
    final uri = Uri.parse('ws://127.0.0.1:$port?token=$token');
    _channel = WebSocketChannel.connect(uri);
    _sub = _channel!.stream.listen(
      (raw) {
        final frame = parseServerFrame(raw.toString());
        if (frame == null) return;
        if (frame.event == 'command_result') {
          final commandId = frame.data['commandId'] as String?;
          if (commandId != null) {
            final pending = _pending.remove(commandId);
            pending?.complete(
              CommandResult(
                ok: frame.data['ok'] as bool? ?? false,
                error: frame.data['error'] as String?,
                data: _coerceCommandData(frame.data['data']),
              ),
            );
          }
        }
        _frameController.add(frame);
      },
      onError: (Object e, StackTrace st) {
        if (!_frameController.isClosed) {
          _frameController.addError(e, st);
        }
      },
      onDone: () {
        _failPending('WebSocket closed.');
      },
    );
  }

  void _failPending(String message) {
    for (final c in _pending.values) {
      if (!c.isCompleted) {
        c.complete(CommandResult(ok: false, error: message));
      }
    }
    _pending.clear();
  }

  Future<CommandResult> sendCommand(
    String command,
    Map<String, dynamic> data, {
    Duration timeout = const Duration(seconds: 120),
  }) async {
    if (_channel == null) await connect();
    final id = 'cmd-${++_cmdSeq}-${DateTime.now().microsecondsSinceEpoch}';
    final completer = Completer<CommandResult>();
    _pending[id] = completer;
    _channel!.sink.add(ClientFrame(id: id, command: command, data: data).encode());
    return completer.future.timeout(
      timeout,
      onTimeout: () {
        _pending.remove(id);
        return CommandResult(ok: false, error: 'Command timed out: $command');
      },
    );
  }

  static Object? _coerceCommandData(Object? raw) {
    if (raw is Map) {
      return _coerceJsonMap(raw);
    }
    return raw;
  }

  static Map<String, dynamic> _coerceJsonMap(Map raw) {
    final out = <String, dynamic>{};
    raw.forEach((key, value) {
      final k = key.toString();
      if (value is Map) {
        out[k] = _coerceJsonMap(value);
      } else if (value is List) {
        out[k] = value
            .map((item) => item is Map ? _coerceJsonMap(item) : item)
            .toList();
      } else {
        out[k] = value;
      }
    });
    return out;
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _failPending('Transport disposed.');
    await _sub?.cancel();
    await _channel?.sink.close();
    await _frameController.close();
    _channel = null;
  }
}

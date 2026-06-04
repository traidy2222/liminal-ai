import 'dart:convert';

import 'version.dart';

/// Server → UI event frame (matches `@liminal/protocol` ServerFrame).
class ServerFrame {
  ServerFrame({
    required this.event,
    required this.data,
    this.chatId,
    this.version = kProtocolVersion,
  });

  final int version;
  final String event;
  final Map<String, dynamic> data;
  final String? chatId;

  factory ServerFrame.fromJson(Map<String, dynamic> json) {
    return ServerFrame(
      version: (json['v'] as num?)?.toInt() ?? kProtocolVersion,
      event: json['event'] as String,
      data: Map<String, dynamic>.from(json['data'] as Map? ?? {}),
      chatId: json['chatId'] as String?,
    );
  }
}

/// UI → sidecar command frame (matches `@liminal/protocol` ClientFrame).
class ClientFrame {
  ClientFrame({
    required this.id,
    required this.command,
    required this.data,
    this.version = kProtocolVersion,
  });

  final int version;
  final String id;
  final String command;
  final Map<String, dynamic> data;

  Map<String, dynamic> toJson() => {
        'v': version,
        't': 'cmd',
        'id': id,
        'command': command,
        'data': data,
      };

  String encode() => jsonEncode(toJson());
}

ServerFrame? parseServerFrame(String raw) {
  try {
    final parsed = jsonDecode(raw);
    if (parsed is! Map<String, dynamic>) return null;
    if (parsed['t'] != 'evt') return null;
    if (parsed['event'] is! String) return null;
    return ServerFrame.fromJson(parsed);
  } catch (_) {
    return null;
  }
}

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import '../lib/core/protocol_client.dart';
import '../lib/protocol/frames.dart';

void main() {
  test(
    'chat focus requests reach the global controller over the real transport',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final connected = Completer<WebSocket>();
      server.listen((request) async {
        connected.complete(await WebSocketTransformer.upgrade(request));
      });
      final client = ProtocolClient();
      WebSocket? socket;
      final focus = Completer<ServerFrame>();
      final chat = Completer<String>();
      client.onGlobalFrame = (frame) {
        if (frame.event == 'chat_focus_requested') focus.complete(frame);
      };
      client.onChatFrame = (id, event, data) {
        if (event == 'text') chat.complete(id);
      };
      try {
        await client.connect(port: server.port, token: 'local-test-only');
        socket = await connected.future.timeout(const Duration(seconds: 3));
        socket.add(
          jsonEncode({
            'v': 1,
            't': 'evt',
            'event': 'chat_focus_requested',
            'data': {'chatId': 'launch-demo'},
          }),
        );
        final frame = await focus.future.timeout(const Duration(seconds: 3));
        expect(frame.data['chatId'], 'launch-demo');
        expect(frame.chatId, isNull);
        expect(chat.isCompleted, isFalse);
        socket.add(
          jsonEncode({
            'v': 1,
            't': 'evt',
            'event': 'text',
            'chatId': 'launch-demo',
            'data': {'channel': 'user', 'delta': 'Working on it.'},
          }),
        );
        expect(
          await chat.future.timeout(const Duration(seconds: 3)),
          'launch-demo',
        );
      } finally {
        await client.disconnect();
        await socket?.close();
        await server.close(force: true);
      }
    },
  );
}

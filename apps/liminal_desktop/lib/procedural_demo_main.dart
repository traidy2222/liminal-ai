// Development-only entry point. Uses the production ProcedurePanel and transport.
// No installed configuration, normal startup, auto-update or provider keys loaded.
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';
import 'transport/ws_transport.dart';
import 'ui/widgets/procedure_panel.dart';
import 'ui/theme/liminal_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final configPath = Platform.environment['LIMINAL_PROCEDURE_DEMO_CONFIG'];
  if (configPath == null) {
    throw StateError(
      'Set LIMINAL_PROCEDURE_DEMO_CONFIG to an isolated demo host config',
    );
  }
  final config = Map<String, dynamic>.from(
    jsonDecode(await File(configPath).readAsString()) as Map,
  );
  await windowManager.ensureInitialized();
  await windowManager.waitUntilReadyToShow(
      const WindowOptions(
        size: Size(1180, 860),
        title: 'Liminal - Isolated Procedural Memory Demo',
      ), () async {
    await windowManager.show();
    await windowManager.focus();
  });
  final transport = WsTransport(
    port: config['port'] as int,
    token: config['token'] as String,
  );
  await transport.connect();
  runApp(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: buildLiminalTheme(),
      home: _Demo(config: config, transport: transport),
    ),
  );
}

class _Demo extends StatefulWidget {
  const _Demo({required this.config, required this.transport});
  final Map<String, dynamic> config;
  final WsTransport transport;
  @override
  State<_Demo> createState() => _DemoState();
}

class _DemoState extends State<_Demo> {
  int revision = 0;
  bool busy = false;
  String status =
      'Acquire a procedure from a corrected, objectively checked episode.';
  String next = 'Acquire';
  Future<Map<String, dynamic>> command(
    String action,
    Map<String, dynamic> payload,
  ) async {
    final result = await widget.transport.sendCommand(
      'procedure_manage',
      {'chatId': widget.config['chatId'], 'action': action, ...payload},
    );
    if (!result.ok) {
      throw StateError(result.error ?? 'Procedure command failed');
    }
    return Map<String, dynamic>.from(result.data as Map? ?? {});
  }

  Future<void> advance() async {
    setState(() => busy = true);
    final client = HttpClient();
    try {
      final request = await client.postUrl(
        Uri.parse('http://127.0.0.1:${widget.config['demoPort']}/advance'),
      );
      request.headers.set('Authorization', 'Bearer ${widget.config['token']}');
      final response = await request.close();
      final body = await utf8.decoder.bind(response).join();
      if (response.statusCode != 200) throw StateError(body);
      final result = jsonDecode(body) as Map;
      setState(() {
        revision++;
        status =
            '${result['phase']} completed in fresh process ${result['pid']}. Inspect the real stored evidence below.';
        next = switch (result['next']) {
          'reuse' => 'Restart and reuse',
          'unrelated' => 'Unrelated README edit',
          'drift' => 'Change relevant convention',
          'repair' => 'Repair immutable version',
          _ => 'Complete'
        };
      });
    } catch (e) {
      setState(() => status = e.toString());
    } finally {
      client.close();
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Column(
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Evidence-backed procedural memory',
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        const Text(
                          'ISOLATED OFFLINE DEMO · real harness and tools · scripted controller · zero model calls',
                        ),
                        const SizedBox(height: 8),
                        Text(status),
                      ],
                    ),
                  ),
                  const SizedBox(width: 20),
                  FilledButton(
                    onPressed: busy || next == 'Complete' ? null : advance,
                    child: Text(busy ? 'Running fixture…' : next),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ProcedurePanel(key: ValueKey(revision), command: command),
            ),
          ],
        ),
      );
}

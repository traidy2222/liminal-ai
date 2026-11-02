import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/models/integrations_snapshot.dart';
import 'package:liminal_desktop/protocol/chat_summary.dart';
import 'package:liminal_desktop/ui/screens/hub/workspace_hub.dart';
import 'package:liminal_desktop/ui/theme/liminal_theme.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    await (FontLoader('MaterialIcons')
          ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf')))
        .load();
    for (final entry in {
      'Space Grotesk': 'SpaceGrotesk.ttf',
      'Inter': 'Inter-Regular.ttf',
      'JetBrains Mono': 'JetBrainsMono-Regular.ttf',
    }.entries) {
      await (FontLoader(entry.key)
            ..addFont(rootBundle.load('assets/fonts/${entry.value}')))
          .load();
    }
  });

  testWidgets(
      'hub bounds recent chats and supports search, filters, pagination and navigation',
      (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1600, 1100);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final boundary = GlobalKey();
    var created = 0;
    var inbox = 0;
    String? opened;
    final chats = List.generate(
        20,
        (i) => ChatSummary(
              chatId: '$i',
              title: [
                    'Build the next release',
                    'Research notes',
                    'Design system exploration',
                    'API integration review',
                    'Documentation refresh',
                    'Plan the next sprint',
                  ][i % 6] +
                  ' $i',
              workspaceRoot: i == 0
                  ? 'C:/Projects/unique-workspace'
                  : 'C:/Projects/Liminal',
              updatedAt: DateTime.now().millisecondsSinceEpoch - i * 3600000,
              busy: i == 1,
              active: false,
              awaitingPersonaBootstrap: false,
            ),);
    Widget fixture() => MaterialApp(
        theme: buildLiminalTheme(),
        home: RepaintBoundary(
            key: boundary,
            child: WorkspaceHub(
              chats: chats,
              integrations: IntegrationsSnapshot.fromJson({
                'connections': [
                  {'kind': 'mcp', 'name': 'github', 'parentProvider': 'github'},
                ],
              }),
              personaName: 'Liminal',
              accountLabel: 'Personal workspace',
              online: true,
              opening: false,
              refreshing: false,
              inboxCount: 4,
              inboxNeedsAction: 1,
              missionActive: false,
              mission: const TextField(
                  key: ValueKey('test-mission-goal'),
                  decoration:
                      InputDecoration(labelText: 'Mission editor fixture'),),
              onNewChat: () => created++,
              onOpenChat: (id) => opened = id,
              onDeleteChat: (_) {},
              onInbox: () => inbox++,
              onIntegrations: () {},
              onSettings: () {},
              onRefresh: () async {},
            ),),);
    await tester.pumpWidget(fixture());
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Build the next release 0'), findsOneWidget);
    expect(find.text('Build the next release 6'), findsNothing);
    await _capture(tester, boundary, 'hub-wide');

    await tester.tap(find.text('Start a conversation'));
    expect(created, 1);
    await tester.tap(find.text('Build the next release 0'));
    expect(opened, '0');
    await tester.tap(find.text('4 new in your inbox'));
    expect(inbox, 1);
    await tester.tap(find.text('Open mission control'));
    await tester.pumpAndSettle();
    expect(find.text('Mission editor fixture'), findsOneWidget);
    await tester.enterText(
        find.byKey(const ValueKey('test-mission-goal')), 'Keep this draft',);
    expect(created, 1); // Browsing mission control never starts work.
    await tester.tap(find.text('Conversations').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mission control').first);
    await tester.pumpAndSettle();
    expect(find.text('Keep this draft'), findsOneWidget);
    await tester.tap(find.text('Conversations').first);
    await tester.pumpAndSettle();
    expect(find.text('Build the next release 6'), findsOneWidget);
    expect(find.text('Build the next release 12'), findsNothing);
    await tester.ensureVisible(find.text('Show more · 8 remaining'));
    await tester.tap(find.text('Show more · 8 remaining'));
    await tester.pumpAndSettle();
    expect(find.text('Build the next release 12'), findsOneWidget);
    await tester.ensureVisible(find.byType(TextField));
    await tester.enterText(find.byType(TextField), 'unique-workspace');
    await tester.pumpAndSettle();
    expect(find.text('Build the next release 0'), findsOneWidget);
    expect(find.text('Research notes 1'), findsNothing);
    await tester.enterText(find.byType(TextField), '');
    await tester.tap(find.text('Working · 1'));
    await tester.pumpAndSettle();
    expect(find.text('Research notes 1'), findsOneWidget);
    expect(find.text('Build the next release 0'), findsNothing);

    await tester.tap(find.text('Overview').first);
    await tester.pumpAndSettle();
    tester.view.physicalSize = const Size(390, 844);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await _capture(tester, boundary, 'hub-narrow');
    await tester.tap(find.byTooltip('Open workspace navigation'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Connected tools').first);
    await tester.pumpAndSettle();
    expect(find.text('Bring your tools together.'), findsOneWidget);
    expect(find.byType(Drawer), findsNothing);
    expect(tester.takeException(), isNull);
    tester.view.physicalSize = const Size(320, 600);
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Open workspace navigation'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}

Future<void> _capture(WidgetTester tester, GlobalKey key, String name) async {
  if (Platform.environment['LIMINAL_CAPTURE_DESIGN'] != '1') return;
  await tester.runAsync(() async {
    final render =
        key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final image = await render.toImage();
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await File('../../.agent_artifacts/$name.png')
        .writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

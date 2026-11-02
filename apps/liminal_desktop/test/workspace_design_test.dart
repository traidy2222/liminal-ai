import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/models/persona_ui_layout.dart';
import 'package:liminal_desktop/models/persona_ui_theme.dart';
import 'package:liminal_desktop/protocol/chat_summary.dart';
import 'package:liminal_desktop/ui/design_system/shells/chat_composer_shell.dart';
import 'package:liminal_desktop/ui/theme/liminal_theme.dart';
import 'package:liminal_desktop/ui/widgets/chat_drawer.dart';
import 'package:liminal_desktop/ui/widgets/composer.dart';
import 'package:liminal_desktop/ui/widgets/workspace_welcome.dart';

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
      'workspace scales, searches chats, and drafts starters without sending',
      (tester) async {
    final draft = ComposerDraftController();
    addTearDown(draft.dispose);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    var sent = 0;
    String? selected;
    final boundary = GlobalKey();
    const theme = PersonaUiTheme.liminalDefault;
    final chats = [
      'A fresh start',
      'Design system exploration',
      'Notes for the next release',
    ]
        .indexed
        .map((entry) => ChatSummary(
            chatId: '${entry.$1}',
            title: entry.$2,
            workspaceRoot: 'C:/Projects/Liminal',
            updatedAt: 100 - entry.$1,
            busy: false,
            active: entry.$1 == 0,
            awaitingPersonaBootstrap: false,),)
        .toList();
    Widget fixture(bool wide) => MaterialApp(
          theme: buildLiminalTheme(),
          home: RepaintBoundary(
            key: boundary,
            child: Scaffold(
              body: Row(
                children: [
                  if (wide)
                    SizedBox(
                        width: 272,
                        child: ChatDrawer(
                            embedded: true,
                            chats: chats,
                            activeChatId: '0',
                            visibleChatIds: const ['0'],
                            onHome: () {},
                            onSelect: (id) => selected = id,
                            onOpenBeside: (_) {},
                            onNewChat: () {},
                            onDelete: (_) {},),),
                  Expanded(
                    child: Column(
                      children: [
                        AppBar(
                            automaticallyImplyLeading: false,
                            toolbarHeight: 76,
                            title: const Text('A fresh start'),),
                        Expanded(
                            child: WorkspaceWelcome(onStart: draft.suggest),),
                        ChatComposerShell(
                            theme: theme,
                            layout: PersonaLayoutSpec.fromTheme(theme),
                            child: Composer(
                                draftController: draft,
                                enabled: true,
                                busy: false,
                                onSend: (_, __, {workflowPreset}) => sent++,
                                onAbort: () {},),),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );

    tester.view.physicalSize = const Size(1440, 1000);
    await tester.pumpWidget(fixture(true));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    // Opt-in captures are review artifacts, not platform-specific golden baselines.
    if (Platform.environment['LIMINAL_CAPTURE_DESIGN'] == '1') {
      await tester.runAsync(() async {
        final image = await (boundary.currentContext!.findRenderObject()!
                as RenderRepaintBoundary)
            .toImage();
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        await Directory('../../.agent_artifacts').create(recursive: true);
        await File('../../.agent_artifacts/desktop-workspace.png')
            .writeAsBytes(data!.buffer.asUint8List());
        image.dispose();
      });
    }
    await tester.tap(find.text('Bug to verified patch'));
    await tester.pump();
    final composerField = find.descendant(
        of: find.byType(Composer), matching: find.byType(TextField),);
    expect(tester.widget<TextField>(composerField).controller!.text,
        contains('/fix'),);
    expect(sent, 0);
    await tester.enterText(composerField, '/fix sum returns an incorrect total');
    await tester.tap(find.text('Send'));
    await tester.pump();
    expect(sent, 1);
    // Selecting the same starter again must refill a cleared draft.
    await tester.tap(find.text('Bug to verified patch'));
    await tester.pump();
    expect(
        tester.widget<TextField>(composerField).controller!.text, isNotEmpty,);
    await tester.enterText(
        find.descendant(
            of: find.byType(ChatDrawer), matching: find.byType(TextField),),
        'release',);
    await tester.pump();
    expect(find.text('Design system exploration'), findsNothing);
    await tester.tap(find.text('Notes for the next release'));
    expect(selected, '2');
    expect(find.byType(WorkspaceWelcome),
        findsOneWidget,); // embedded navigation did not pop the route

    tester.view.physicalSize = const Size(430, 900);
    await tester.pumpWidget(fixture(false));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Receipt to expense'), findsOneWidget);
    if (Platform.environment['LIMINAL_CAPTURE_DESIGN'] == '1') {
      await tester.runAsync(() async {
        final image = await (boundary.currentContext!.findRenderObject()!
                as RenderRepaintBoundary)
            .toImage();
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        await File('../../.agent_artifacts/desktop-narrow.png')
            .writeAsBytes(data!.buffer.asUint8List());
        image.dispose();
      });
    }
    await tester.pumpWidget(const SizedBox.shrink());
  });
}

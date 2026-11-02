import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/app/app_scope.dart';
import 'package:liminal_desktop/models/harness_settings.dart';
import 'package:liminal_desktop/state/app_controller.dart';
import 'package:liminal_desktop/ui/screens/settings_screen.dart';
import 'package:liminal_desktop/ui/widgets/managed_inference_panel.dart';
import 'package:liminal_desktop/ui/theme/liminal_theme.dart';

class SettingsFixtureHost extends AppController {
  SettingsFixtureHost() : super(repoRoot: Directory.systemTemp.path) {
    phase = ConnectionPhase.connected;
    sidecarReady = true;
    harnessSettings = HarnessSettingsSnapshot.fromJson({
      'tabs': [
        {'id': 'session_ui', 'title': 'Session'},
        {'id': 'harness', 'title': 'Harness'}
      ],
      'fields': [
        {
          'key': 'AGENT_SESSION_GREET',
          'label': 'Session greet',
          'tabId': 'session_ui',
          'subgroupId': 'session_ui',
          'subgroupLabel': 'Conversation',
          'valueKind': 'boolean',
          'value': '0'
        },
        {
          'key': 'AGENT_TRACE_INTERNAL',
          'label': 'Internal trace',
          'tabId': 'session_ui',
          'subgroupId': 'session_ui',
          'subgroupLabel': 'Conversation',
          'valueKind': 'boolean',
          'value': '0'
        },
        {
          'key': 'AGENT_RETRY_INTERNAL',
          'label': 'Retry budget',
          'tabId': 'harness',
          'subgroupId': 'resilience',
          'subgroupLabel': 'Recovery',
          'valueKind': 'number',
          'value': '5'
        },
      ],
      'provider': {
        'model': 'example/model',
        'baseURL': 'http://localhost:1234/v1'
      },
    });
  }
  final changes = <Map<String, String>>[];
  @override
  Future<void> loadVireonAccount() async {}
  @override
  Future<void> loadHarnessSettings({bool reconnectVireon = false}) async {}
  @override
  Future<void> loadManagedInferenceModels() async {}
  @override
  Future<void> loadDesktopApps() async {}
  @override
  Future<bool> patchHarnessSettings(Map<String, String> envPatch) async {
    changes.add(envPatch);
    return true;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('mixin.one/desktop_multi_window/channels'),
      (_) async => null,
    );
    await (FontLoader('MaterialIcons')
          ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf')))
        .load();
    for (final entry in {
      'Space Grotesk': 'SpaceGrotesk.ttf',
      'Inter': 'Inter-Regular.ttf'
    }.entries) {
      await (FontLoader(entry.key)
            ..addFont(rootBundle.load('assets/fonts/${entry.value}')))
          .load();
    }
  });
  testWidgets('managed model errors stay readable on narrow screens', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(
      theme: buildLiminalTheme(),
      home: Scaffold(body: SingleChildScrollView(child: ManagedInferencePanel(
        mainModel: 'example/model', fastModel: 'example/fast', catalog: null,
        loading: false, error: 'expired', saving: false, managedProvider: 'openrouter',
        onMainModel: (_) {}, onFastModel: (_) {}, onManagedProvider: (_) {},
      ))),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Your managed-model session has expired. Sign in again from Account.'), findsOneWidget);
    expect(find.text('expired'), findsNothing);
    await tester.tap(find.text('Technical details'));
    await tester.pumpAndSettle();
    expect(find.text('expired'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
      'settings reveals advanced fields without losing search or save behavior',
      (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1440, 1000);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final host = SettingsFixtureHost();
    final boundary = GlobalKey();
    await tester.pumpWidget(MaterialApp(
        theme: buildLiminalTheme(),
        home: AppScope(
            controller: host,
            child: RepaintBoundary(
                key: boundary, child: const SettingsScreen()))));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await captureSettings(tester, boundary, 'settings-desktop-model');
    await tester.tap(find.text('Preferences').first);
    await tester.pumpAndSettle();
    expect(find.text('Opening greeting'), findsOneWidget);
    expect(find.text('Internal trace'), findsNothing);
    await tester.tap(find.text('Opening greeting'));
    await tester.pumpAndSettle();
    expect(host.changes.single, {'AGENT_SESSION_GREET': '1'});
    await tester.tap(find.text('Show advanced options'));
    await tester.pumpAndSettle();
    expect(find.text('Internal trace'), findsOneWidget);
    await captureSettings(tester, boundary, 'settings-desktop-preferences');
    final search = find.widgetWithText(
        TextField, 'Search all settings, including advanced…');
    await tester.enterText(search, 'Retry budget');
    await tester.pumpAndSettle();
    expect(find.text('Retry budget'), findsNWidgets(2));
    expect(find.text('Model & provider'),
        findsOneWidget); // Navigation only, no provider form in results.
    await tester.enterText(search, 'nothing-matches-this');
    await tester.pumpAndSettle();
    expect(find.text('No matching settings. Try another name or keyword.'),
        findsOneWidget);
    tester.view.physicalSize = const Size(390, 844);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await captureSettings(tester, boundary, 'settings-desktop-narrow');
    await tester.pumpWidget(const SizedBox.shrink());
    host.dictation.onCaptureActiveChange = null;
    host.dispose();
  });
}

Future<void> captureSettings(
    WidgetTester tester, GlobalKey key, String name) async {
  if (Platform.environment['LIMINAL_CAPTURE_DESIGN'] != '1') return;
  await tester.runAsync(() async {
    final image =
        await (key.currentContext!.findRenderObject()! as RenderRepaintBoundary)
            .toImage();
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await File('../../.agent_artifacts/$name.png')
        .writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

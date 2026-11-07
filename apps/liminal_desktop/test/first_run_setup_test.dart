import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:record/record.dart';
import 'asr_review_test.dart' show RecorderFixture;
import 'package:liminal_desktop/models/app_config.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/app/app_scope.dart';
import 'package:liminal_desktop/state/app_controller.dart';
import 'package:liminal_desktop/state/chat_session_controller.dart';
import 'package:liminal_desktop/ui/screens/provider_setup_screen.dart';
import 'package:liminal_desktop/ui/screens/persona_bootstrap_screen.dart';
import 'package:liminal_desktop/ui/theme/liminal_theme.dart';

class SetupController extends AppController {
  Map<String, Object?>? saved;
  @override
  Future<List<Map<String, dynamic>>> discoverProviderModels({
    required String baseUrl,
    String apiKey = '',
  }) async => [
    {'id': 'local/test', 'name': 'Loaded local model', 'toolCalling': null},
  ];
  @override
  Future<bool> saveProvider({
    required String apiKey,
    String? model,
    String? baseUrl,
    bool requireApiKey = true,
  }) async {
    saved = {'key': apiKey, 'model': model, 'requiresKey': requireApiKey};
    return false;
  }
}

class PersonaSetupController extends SetupController {
  String? submittedName;
  @override
  Future<bool> patchHarnessSettings(Map<String, String> patch) async => true;
  @override
  Future<bool> submitPersonaBootstrap(
    String input, {
    bool skip = false,
    String? name,
  }) async {
    submittedName = name;
    return true;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late RecordPlatform previousRecorder;
  late RecorderFixture recorder;
  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('mixin.one/desktop_multi_window/channels'),
          (_) async => null,
        );
    previousRecorder = RecordPlatform.instance;
    recorder = RecorderFixture();
    RecordPlatform.instance = recorder;
  });
  tearDown(() async {
    await Future<void>.delayed(const Duration(milliseconds: 20));
    await recorder.pcm.close();
    RecordPlatform.instance = previousRecorder;
  });
  testWidgets(
    'local first run discovers a loaded model and continues without a cloud key',
    (tester) async {
      tester.view.physicalSize = const Size(1400, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final controller = SetupController();
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        AppScope(
          controller: controller,
          child: MaterialApp(
            theme: buildLiminalTheme(),
            home: const SetupScreen(),
          ),
        ),
      );
      expect(find.text('API key'), findsOneWidget);
      await tester.tap(find.text('Local'));
      await tester.pump();
      expect(find.text('Server key (optional)'), findsOneWidget);
      await tester.ensureVisible(find.text('Load available models'));
      await tester.tap(find.text('Load available models'));
      await tester.pump();
      await tester.pump();
      expect(find.text('Loaded local model'), findsOneWidget);
      await tester.ensureVisible(find.text('Verify and continue'));
      await tester.tap(find.text('Verify and continue'));
      await tester.pump();
      expect(controller.saved, {
        'key': '',
        'model': 'local/test',
        'requiresKey': false,
      });
      expect(tester.takeException(), isNull);
    },
  );
  test(
    'unverified credentials gate persona setup and verification can be revisited',
    () {
      final controller = SetupController();
      addTearDown(controller.dispose);
      controller.config = AppConfig.fromJson({
        'apiKeyConfigured': true,
        'personaBootstrapPending': true,
        'providerVerified': false,
      });
      expect(controller.needsProviderSetup, isTrue);
      controller.config = controller.config!.copyWith(providerManaged: true);
      expect(controller.needsProviderSetup, isFalse);
      controller.config = controller.config!.copyWith(
        providerManaged: false,
        providerVerified: true,
      );
      expect(controller.needsProviderSetup, isFalse);
      controller.requestProviderSetup();
      expect(controller.needsProviderSetup, isTrue);
    },
  );
  testWidgets('saved cloud key can be verified without retyping the secret', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1400, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = SetupController();
    addTearDown(controller.dispose);
    controller.config = AppConfig.fromJson({
      'apiKeyConfigured': true,
      'personaBootstrapPending': true,
      'providerVerified': false,
      'provider': {
        'baseURL': 'https://openrouter.ai/api/v1',
        'model': 'cloud/model',
      },
    });
    await tester.pumpWidget(
      AppScope(
        controller: controller,
        child: MaterialApp(
          theme: buildLiminalTheme(),
          home: const SetupScreen(),
        ),
      ),
    );
    expect(find.text('Saved key will be verified'), findsOneWidget);
    await tester.ensureVisible(find.text('Verify and continue'));
    await tester.tap(find.text('Verify and continue'));
    await tester.pump();
    expect(controller.saved, {
      'key': '',
      'model': 'cloud/model',
      'requiresKey': false,
    });
  });
  testWidgets('persona name is submitted separately from writing preferences', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1400, 1700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = PersonaSetupController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      AppScope(
        controller: controller,
        child: MaterialApp(
          theme: buildLiminalTheme(),
          home: const PersonaBootstrapScreen(),
        ),
      ),
    );
    await tester.enterText(find.byType(TextField).at(0), 'Sherlock Holmes');
    await tester.enterText(
      find.byType(TextField).at(1),
      'A deductive consulting detective',
    );
    await tester.pump();
    await tester.ensureVisible(find.text('Generate personality and start'));
    await tester.tap(find.text('Generate personality and start'));
    await tester.pump();
    await tester.pump();
    expect(controller.submittedName, 'Sherlock Holmes');
  });
  test(
    'persona cancellation releases the busy state and retains previews for retry',
    () {
      final session = ChatSessionController(chatId: 'setup');
      session.applyServerEvent('persona_bootstrap_progress', {
        'stage': 'generating',
        'message': 'Working',
        'artifacts': [
          {'id': 'runtime_profile', 'content': 'draft'},
        ],
      });
      expect(session.busy, isTrue);
      expect(session.personaBootstrapArtifacts.length, 1);
      session.applyServerEvent('persona_bootstrap_progress', {
        'stage': 'failed',
        'message': 'Cancelled',
      });
      expect(session.busy, isFalse);
      session.applyServerEvent('persona_bootstrap_progress', {
        'stage': 'done',
        'message': 'Ready',
      });
      expect(session.busy, isFalse);
      session.dispose();
    },
  );
}

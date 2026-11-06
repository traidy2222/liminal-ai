import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:webview_win_floating/webview_win_floating.dart';
import 'package:webview_win_floating/webview_win_floating_method_channel.dart';
import 'package:webview_win_floating/webview_win_floating_platform_interface.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:liminal_desktop/browser/native_tab_creation.dart';

void main() {
  final binding = TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('webview_win_floating');
  final calls = <String>[];
  Future<Object?> Function(MethodCall)? native;
  setUp(() {
    calls.clear();
    native = null;
    binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (
      call,
    ) async {
      calls.add(call.method);
      return native == null ? true : await native!(call);
    });
    WebviewWinFloatingPlatform.instance = MethodChannelWebviewWinFloating();
  });
  tearDown(() {
    binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, null);
  });

  test('platform adapter returns JavaScript setup failures to its caller', () async {
    native = (call) async {
      if (call.method == 'addScriptChannelByName') {
        throw PlatformException(code: 'script_setup_failed');
      }
      return true;
    };
    final controller = WindowsPlatformWebViewController(
      const WindowsWebViewControllerCreationParams(),
    );
    await expectLater(WebViewController.fromPlatform(controller).addJavaScriptChannel(
      'testChannel', onMessageReceived: (_) {},
    ), throwsA(isA<PlatformException>()));
    await controller.controller.dispose();
  });

  test(
    'failed creation reports its original error and skips native disposal',
    () async {
      native = (call) async {
        if (call.method == 'create') {
          throw PlatformException(
            code: 'webview_create_failed',
            message: 'HRESULT 0x8007139f',
          );
        }
        return true;
      };
      final controller = WinWebViewController();
      await expectLater(
        controller.loadRequest(Uri.parse('https://example.com')),
        throwsA(
          isA<PlatformException>().having(
            (e) => e.message,
            'native code',
            contains('8007139f'),
          ),
        ),
      );
      await controller.dispose();
      await controller.dispose();
      await controller.setVisibility(false);
      expect(calls.where((call) => call == 'dispose'), isEmpty);
      expect(
        (WebviewWinFloatingPlatform.instance as MethodChannelWebviewWinFloating)
            .webviewMap,
        isEmpty,
      );
    },
  );

  test(
    'disposal waits for creation and closes the native view exactly once',
    () async {
      final created = Completer<Object?>();
      native = (call) async =>
          call.method == 'create' ? await created.future : true;
      final controller = WinWebViewController();
      final first = controller.dispose();
      final second = controller.dispose();
      expect(calls.where((call) => call == 'dispose'), isEmpty);
      created.complete(true);
      await Future.wait([first, second]);
      expect(calls.where((call) => call == 'dispose'), hasLength(1));
    },
  );

  test(
    'native startup retries once with a new controller after cleanup',
    () async {
      var attempts = 0;
      native = (call) async {
        if (call.method == 'create' && ++attempts == 1) {
          throw PlatformException(code: 'webview_create_failed');
        }
        return true;
      };
      final result = await createNativeBrowserTab(() async {
        final controller = WinWebViewController();
        try {
          await controller.loadRequest(Uri.parse('https://example.com'));
          return controller;
        } catch (_) {
          await controller.dispose();
          rethrow;
        }
      });
      expect(attempts, 2);
      expect(calls.where((call) => call == 'loadUrl'), hasLength(1));
      await result.dispose();
      expect(calls.where((call) => call == 'dispose'), hasLength(1));
    },
  );

  test(
    'persistent native errors stop after two attempts; other errors are not retried',
    () async {
      var attempts = 0;
      await expectLater(
        createNativeBrowserTab(() async {
          attempts++;
          throw PlatformException(code: 'webview_create_failed');
        }),
        throwsA(isA<PlatformException>()),
      );
      expect(attempts, 2);
      attempts = 0;
      await expectLater(
        createNativeBrowserTab(() async {
          attempts++;
          throw PlatformException(code: 'navigation_denied');
        }),
        throwsA(isA<PlatformException>()),
      );
      expect(attempts, 1);
    },
  );
}

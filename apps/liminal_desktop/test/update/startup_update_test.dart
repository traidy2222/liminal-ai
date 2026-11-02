import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:liminal_desktop/core/update/local_versions.dart';
import 'package:liminal_desktop/core/update/release_client.dart';
import 'package:liminal_desktop/core/update/update_coordinator.dart';
import 'package:liminal_desktop/models/update_prefs.dart';

Map<String, dynamic> release(String version,
    {bool complete = true, bool draft = false}) {
  final files = [
    for (final os in ['windows', 'macos', 'linux'])
      ReleaseClient.desktopArtifactFile(os, version),
    ReleaseClient.liminaldRuntimeFile(version)
  ];
  return {
    'tag_name': 'v$version-desktop',
    'draft': draft,
    'published_at': '2026-11-02T00:00:00Z',
    'assets': [
      for (final f in files) ...[
        {
          'name': f,
          'state': 'uploaded',
          'browser_download_url': 'https://fixtures.invalid/$f'
        },
        {
          'name': '$f.sha256',
          'state': 'uploaded',
          'browser_download_url': 'https://fixtures.invalid/$f.sha256'
        }
      ],
      if (complete)
        {
          'name': 'liminal-desktop-manifest-v$version.json',
          'state': 'uploaded',
          'browser_download_url': 'https://fixtures.invalid/manifest'
        },
    ]
  };
}

class Fixture {
  Fixture(this.root);
  final Directory root;
  UpdatePrefs stored = const UpdatePrefs();
  int installs = 0, downloads = 0, checks = 0;
  final bytes = utf8.encode('synthetic archive bytes');
  Future<void> install(LocalVersions local, String archive) async {
    installs++;
    expect(await File(archive).readAsBytes(), bytes);
  }

  UpdateCoordinator coordinator(
      {bool dev = false,
      bool portable = true,
      String app = '1.0.0',
      String harness = '1.0.0',
      bool badHash = false,
      bool missingHash = false,
      bool offline = false,
      Future<http.Response> Function()? metadata,
      Future<UpdatePrefs> Function()? readPrefs,
      Future<void> Function(LocalVersions, String)? installer,
      http.Client? transport}) {
    final client = MockClient((request) async {
      if (request.url.host == 'api.github.com') {
        checks++;
        if (metadata != null) return metadata();
        return http.Response(
            offline ? 'unavailable' : jsonEncode([release('2.0.0')]),
            offline ? 503 : 200);
      }
      if (request.url.path.endsWith('.sha256'))
        return http.Response(
            missingHash
                ? 'missing'
                : '${badHash ? 'a' * 64 : sha256.convert(bytes)}  archive.zip',
            missingHash ? 404 : 200);
      downloads++;
      return http.Response.bytes(bytes, 200);
    });
    return UpdateCoordinator(
        repoRoot: null,
        shutdownSidecar: () async {},
        reboot: () async {},
        releaseClient: ReleaseClient(
            client: client, requestTimeout: const Duration(milliseconds: 100)),
        httpClient: transport ?? client,
        loadLocalVersions: () async => LocalVersions(
            appVersion: app,
            harnessVersion: harness,
            isPortableInstall: portable,
            isDevBuild: dev,
            exeDir: root.path),
        readPreferences: readPrefs ?? () async => stored,
        writePreferences: (p) async {
          stored = p;
        },
        temporaryDirectory: () async => root,
        installAndRestart: installer ?? install);
  }
}

Future<Fixture> fixture() async =>
    Fixture(await Directory.systemTemp.createTemp('liminal-startup-test-'));
void main() {
  test('a packaged runtime root is not a development override', () {
    final bundled = Directory.systemTemp.path;
    expect(LocalVersions.usesExternalRepoRoot(bundled, bundled), isFalse);
    expect(
        LocalVersions.usesExternalRepoRoot('$bundled/external-source', bundled),
        isTrue);
    expect(LocalVersions.usesExternalRepoRoot(bundled, null), isTrue);
  });

  test(
      'launch waits for preferences, checks installed versions, downloads verified app and installs once',
      () async {
    final f = await fixture();
    addTearDown(() => f.root.delete(recursive: true));
    final c = f.coordinator();
    addTearDown(c.dispose);
    final first = c.runLaunchUpdate();
    expect(identical(first, c.runLaunchUpdate()), isTrue);
    expect(await first, isTrue);
    expect(f.installs, 1);
    expect(f.downloads, 1);
    expect(f.checks, 1);
    expect(f.stored.lastAutomaticAttemptVersion, '2.0.0');
    expect(c.state.phase, UpdatePhase.applying);
  });
  test('persisted opt-out is respected before any release request', () async {
    final f = await fixture();
    addTearDown(() => f.root.delete(recursive: true));
    final c = f.coordinator(readPrefs: () async {
      await Future<void>.delayed(const Duration(milliseconds: 10));
      return const UpdatePrefs(autoCheckOnLaunch: false);
    });
    addTearDown(c.dispose);
    expect(await c.runLaunchUpdate(), isFalse);
    expect(f.checks, 0);
    expect(f.installs, 0);
  });
  test('development and non-portable builds do not auto-update', () async {
    final f = await fixture();
    addTearDown(() => f.root.delete(recursive: true));
    for (final c in [
      f.coordinator(dev: true),
      f.coordinator(portable: false)
    ]) {
      expect(await c.runLaunchUpdate(), isFalse);
      c.dispose();
    }
    expect(f.checks, 0);
  });
  test('check-only preference offers the update without installation',
      () async {
    final f = await fixture();
    addTearDown(() => f.root.delete(recursive: true));
    f.stored = const UpdatePrefs(autoInstallOnLaunch: false);
    final c = f.coordinator();
    addTearDown(c.dispose);
    expect(await c.runLaunchUpdate(), isFalse);
    expect(c.state.checkResult?.anyUpdate, isTrue);
    expect(f.downloads, 0);
    expect(f.installs, 0);
  });
  test('a current app opens without downloading', () async {
    final f = await fixture();
    addTearDown(() => f.root.delete(recursive: true));
    f.stored = const UpdatePrefs(lastAutomaticAttemptVersion: '2.0.0');
    final c = f.coordinator(app: '2.0.0', harness: '2.0.0');
    addTearDown(c.dispose);
    expect(await c.runLaunchUpdate(), isFalse);
    expect(f.downloads, 0);
    expect(f.stored.lastAutomaticAttemptVersion, isNull);
  });
  for (final missing in [false, true])
    test('unverified download cannot install: missing checksum=$missing',
        () async {
      final f = await fixture();
      addTearDown(() => f.root.delete(recursive: true));
      final c = f.coordinator(badHash: !missing, missingHash: missing);
      addTearDown(c.dispose);
      expect(await c.runLaunchUpdate(), isFalse);
      expect(f.installs, 0);
      expect(c.state.phase, UpdatePhase.error);
      expect(f.stored.lastAutomaticAttemptVersion, isNull);
      expect(
          await f.root
              .list(recursive: true)
              .where((e) => e.path.endsWith('.part') || e.path.endsWith('.zip'))
              .isEmpty,
          isTrue);
    });
  test('offline startup opens the current version', () async {
    final f = await fixture();
    addTearDown(() => f.root.delete(recursive: true));
    final c = f.coordinator(offline: true);
    addTearDown(c.dispose);
    expect(await c.runLaunchUpdate(), isFalse);
    expect(f.installs, 0);
  });
  test(
      'skipping a pending launch check prevents a later response from installing',
      () async {
    final f = await fixture();
    addTearDown(() => f.root.delete(recursive: true));
    final response = Completer<http.Response>(), started = Completer<void>();
    final c = f.coordinator(metadata: () {
      started.complete();
      return response.future;
    });
    addTearDown(c.dispose);
    final launching = c.runLaunchUpdate();
    await started.future;
    c.skipLaunchUpdate();
    expect(await launching, isFalse);
    response.complete(http.Response(jsonEncode([release('2.0.0')]), 200));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(f.installs, 0);
    expect(f.downloads, 0);
    expect(c.launchUpdateInProgress, isFalse);
  });
  test(
      'failed install is not retried automatically in a restart loop; manual retry remains available',
      () async {
    final f = await fixture();
    addTearDown(() => f.root.delete(recursive: true));
    final c = f.coordinator(installer: (_, __) async {
      throw StateError('fixture install failed');
    });
    expect(await c.runLaunchUpdate(), isFalse);
    expect(f.stored.lastAutomaticAttemptVersion, '2.0.0');
    c.dispose();
    final next = f.coordinator();
    addTearDown(next.dispose);
    expect(await next.runLaunchUpdate(), isFalse);
    expect(f.installs, 0);
    expect(f.downloads, 1);
    expect(await next.scheduleAppRestart(), isTrue);
    expect(f.installs, 1);
    expect(f.downloads, 1); // Verified cached archive reused.
  });
  test('a harness-only update installs one coherent app bundle', () async {
    final f = await fixture();
    addTearDown(() => f.root.delete(recursive: true));
    final c = f.coordinator(app: '2.0.0', harness: '1.0.0');
    addTearDown(c.dispose);
    expect(await c.runLaunchUpdate(), isTrue);
    expect(f.downloads, 1);
    expect(f.installs, 1);
  });
  test(
      'truncated response does not install even when bytes match the advertised digest',
      () async {
    final f = await fixture();
    addTearDown(() => f.root.delete(recursive: true));
    final transport = MockClient.streaming((request, _) async =>
        http.StreamedResponse(Stream.value(f.bytes), 200, contentLength: 1000));
    final c = f.coordinator(transport: transport);
    addTearDown(c.dispose);
    expect(await c.runLaunchUpdate(), isFalse);
    expect(f.installs, 0);
    expect(c.state.error, contains('interrupted'));
  });
  test('incomplete and draft releases are ignored by launch discovery',
      () async {
    final client = ReleaseClient(
        client: MockClient((_) async => http.Response(
            jsonEncode([
              release('3.0.0', complete: false),
              release('2.1.0', draft: true),
              release('2.0.0')
            ]),
            200)));
    addTearDown(client.close);
    expect((await client.fetchLatestDesktopRelease()).version, '2.0.0');
  });
  test(
      'legacy update preferences gain automatic install without overriding an old opt-out',
      () {
    final p = UpdatePrefs.fromJson({'autoCheckOnLaunch': false});
    expect(p.autoCheckOnLaunch, isFalse);
    expect(p.autoInstallOnLaunch, isTrue);
    expect(
        UpdatePrefs.fromJson(
                p.copyWith(lastAutomaticAttemptVersion: '2.0.0').toJson())
            .lastAutomaticAttemptVersion,
        '2.0.0');
  });
  test('a timed-out launch check opens the current app', () async {
    final f = await fixture();
    addTearDown(() => f.root.delete(recursive: true));
    final pending = Completer<http.Response>();
    final c = f.coordinator(metadata: () => pending.future);
    addTearDown(c.dispose);
    expect(
        await c.runLaunchUpdate().timeout(const Duration(seconds: 2)), isFalse);
    expect(f.installs, 0);
  });
  test('skipping a streamed download cancels it and prevents installation',
      () async {
    final f = await fixture();
    addTearDown(() => f.root.delete(recursive: true));
    final chunks = StreamController<List<int>>(), started = Completer<void>();
    final transport = MockClient.streaming((request, _) async {
      if (request is http.Abortable) {
        unawaited(request.abortTrigger!.then((_) async {
          if (!chunks.isClosed) {
            chunks.addError(http.RequestAbortedException());
            await chunks.close();
          }
        }));
      }
      started.complete();
      return http.StreamedResponse(chunks.stream, 200,
          contentLength: f.bytes.length);
    });
    final c = f.coordinator(transport: transport);
    addTearDown(c.dispose);
    final launching = c.runLaunchUpdate();
    await started.future;
    chunks.add(f.bytes.sublist(0, 2));
    final finished = Completer<void>();
    c.addListener(() {
      if (!c.isBusy && !finished.isCompleted) finished.complete();
    });
    c.skipLaunchUpdate();
    expect(await launching, isFalse);
    await finished.future.timeout(const Duration(seconds: 2));
    expect(f.installs, 0);
    expect(
        await f.root
            .list(recursive: true)
            .where((e) => e.path.endsWith('.part') || e.path.endsWith('.zip'))
            .isEmpty,
        isTrue);
  });
}

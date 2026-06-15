import 'dart:convert';
import 'dart:io';

import 'package:archive/archive_io.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../../models/update_prefs.dart';
import 'local_versions.dart';
import 'release_client.dart';

enum UpdatePhase {
  idle,
  checking,
  downloading,
  applying,
  ready,
  error,
}

class UpdateState {
  const UpdateState({
    this.phase = UpdatePhase.idle,
    this.checkResult,
    this.error,
    this.downloadProgress,
    this.harnessArchivePath,
    this.appArchivePath,
  });

  final UpdatePhase phase;
  final UpdateCheckResult? checkResult;
  final String? error;
  final double? downloadProgress;
  final String? harnessArchivePath;
  final String? appArchivePath;

  bool get hasHarnessReady =>
      harnessArchivePath != null && (checkResult?.harnessUpdate ?? false);

  bool get hasAppReady =>
      appArchivePath != null && (checkResult?.appUpdate ?? false);

  UpdateState copyWith({
    UpdatePhase? phase,
    UpdateCheckResult? checkResult,
    String? error,
    double? downloadProgress,
    String? harnessArchivePath,
    String? appArchivePath,
    bool clearError = false,
  }) {
    return UpdateState(
      phase: phase ?? this.phase,
      checkResult: checkResult ?? this.checkResult,
      error: clearError ? null : (error ?? this.error),
      downloadProgress: downloadProgress ?? this.downloadProgress,
      harnessArchivePath: harnessArchivePath ?? this.harnessArchivePath,
      appArchivePath: appArchivePath ?? this.appArchivePath,
    );
  }
}

typedef SidecarShutdown = Future<void> Function();
typedef SidecarReboot = Future<void> Function();

class UpdateCoordinator extends ChangeNotifier {
  UpdateCoordinator({
    required this.repoRoot,
    required this.shutdownSidecar,
    required this.reboot,
    ReleaseClient? releaseClient,
    http.Client? httpClient,
  })  : _client = releaseClient ?? ReleaseClient(client: httpClient),
        _http = httpClient ?? http.Client();

  final String? repoRoot;
  final SidecarShutdown shutdownSidecar;
  final SidecarReboot reboot;
  final ReleaseClient _client;
  final http.Client _http;

  UpdatePrefs prefs = const UpdatePrefs();
  UpdateState state = const UpdateState();
  LocalVersions? _local;

  bool get shouldAutoCheck {
    if (Platform.environment['LIMINAL_SKIP_UPDATE_CHECK'] == '1') return false;
    if (_local?.isDevBuild == true) return false;
    if (_local?.isPortableInstall != true) return false;
    return prefs.autoCheckOnLaunch;
  }

  bool get showBanner {
    final result = state.checkResult;
    if (result == null || !result.anyUpdate) return false;
    if (prefs.dismissedVersion == result.latest.version) return false;
    return state.phase == UpdatePhase.ready ||
        state.hasHarnessReady ||
        state.hasAppReady;
  }

  Future<void> loadPrefs() async {
    prefs = await UpdatePrefsService.load();
    notifyListeners();
  }

  Future<void> savePrefs(UpdatePrefs next) async {
    prefs = next;
    await UpdatePrefsService.save(next);
    notifyListeners();
  }

  Future<void> refreshLocal() async {
    _local = await LocalVersions.load(repoRoot: repoRoot);
  }

  String get _platform {
    if (Platform.isWindows) return 'windows';
    if (Platform.isMacOS) return 'macos';
    return 'linux';
  }

  Future<void> check({bool silent = false}) async {
    await refreshLocal();
    final local = _local;
    if (local == null || local.isDevBuild || !local.isPortableInstall) {
      if (!silent) {
        state = state.copyWith(
          phase: UpdatePhase.idle,
          error: local?.isDevBuild == true
              ? 'Dev build — updates use git (LIMINAL_REPO_ROOT).'
              : 'Not a portable desktop install.',
        );
        notifyListeners();
      }
      return;
    }

    state = state.copyWith(phase: UpdatePhase.checking, clearError: true);
    notifyListeners();

    try {
      final harness = local.harnessVersion ?? local.appVersion;
      final result = await _client.check(
        appVersion: local.appVersion,
        harnessVersion: harness,
      );
      state = state.copyWith(
        phase: result.anyUpdate ? UpdatePhase.ready : UpdatePhase.idle,
        checkResult: result,
        clearError: true,
      );
      await savePrefs(prefs.copyWith(lastCheckAt: DateTime.now().toUtc()));
    } catch (e) {
      state = state.copyWith(
        phase: silent ? UpdatePhase.idle : UpdatePhase.error,
        error: e.toString(),
      );
    }
    notifyListeners();
  }

  Future<String> _downloadAsset(ReleaseAsset asset) async {
    final dir = await getTemporaryDirectory();
    final dest = p.join(dir.path, 'liminal-updates', asset.file);
    await Directory(p.dirname(dest)).create(recursive: true);

    final expected = await _client.fetchSha256(asset.sha256Url);
    final request = http.Request('GET', Uri.parse(asset.url));
    final streamed = await _http.send(request);
    if (streamed.statusCode != 200) {
      throw Exception('Download failed: ${streamed.statusCode}');
    }

    final total = streamed.contentLength ?? 0;
    var loaded = 0;
    final bytes = <int>[];

    await for (final chunk in streamed.stream) {
      loaded += chunk.length;
      bytes.addAll(chunk);
      state = state.copyWith(
        phase: UpdatePhase.downloading,
        downloadProgress: total > 0 ? loaded / total : null,
      );
      notifyListeners();
    }

    final hash = sha256.convert(bytes).toString();
    if (expected != null && hash != expected) {
      throw Exception('SHA256 mismatch for ${asset.file}');
    }
    await File(dest).writeAsBytes(bytes);
    return dest;
  }

  Future<void> downloadHarness() async {
    final result = state.checkResult;
    if (result == null || !result.harnessUpdate) return;
    state = state.copyWith(phase: UpdatePhase.downloading, clearError: true);
    notifyListeners();
    try {
      final path = await _downloadAsset(result.latest.liminaldAsset);
      state = state.copyWith(
        phase: UpdatePhase.ready,
        harnessArchivePath: path,
        clearError: true,
      );
    } catch (e) {
      state = state.copyWith(phase: UpdatePhase.error, error: e.toString());
    }
    notifyListeners();
  }

  Future<void> downloadApp() async {
    final result = state.checkResult;
    if (result == null || !result.appUpdate) return;
    final asset = result.latest.platformAssets[_platform];
    if (asset == null) throw Exception('No asset for $_platform');
    state = state.copyWith(phase: UpdatePhase.downloading, clearError: true);
    notifyListeners();
    try {
      final path = await _downloadAsset(asset);
      state = state.copyWith(
        phase: UpdatePhase.ready,
        appArchivePath: path,
        clearError: true,
      );
    } catch (e) {
      state = state.copyWith(phase: UpdatePhase.error, error: e.toString());
    }
    notifyListeners();
  }

  Future<void> applyHarnessUpdate() async {
    final local = _local ?? await LocalVersions.load(repoRoot: repoRoot);
    final exeDir = local.exeDir;
    if (exeDir == null) throw Exception('Cannot resolve install directory');

    var archive = state.harnessArchivePath;
    if (archive == null) {
      await downloadHarness();
      archive = state.harnessArchivePath;
    }
    if (archive == null) throw Exception('Harness download failed');

    state = state.copyWith(phase: UpdatePhase.applying, clearError: true);
    notifyListeners();

    try {
      await shutdownSidecar();

      if (Platform.isWindows) {
        await _runNodeApply(mode: 'harness', exeDir: exeDir, archive: archive);
      } else {
        await _applyHarnessDart(exeDir, archive);
      }

      await reboot();
      state = const UpdateState(phase: UpdatePhase.idle);
    } catch (e) {
      state = state.copyWith(phase: UpdatePhase.error, error: e.toString());
      await reboot();
    }
    notifyListeners();
  }

  Future<void> scheduleAppRestart() async {
    final local = _local ?? await LocalVersions.load(repoRoot: repoRoot);
    final exeDir = local.exeDir;
    if (exeDir == null) throw Exception('Cannot resolve install directory');

    var archive = state.appArchivePath;
    if (archive == null) {
      await downloadApp();
      archive = state.appArchivePath;
    }
    if (archive == null) throw Exception('App download failed');

    state = state.copyWith(phase: UpdatePhase.applying, clearError: true);
    notifyListeners();

    await File(p.join(exeDir, 'pending_update.json')).writeAsString(
      jsonEncode({
        'archivePath': archive,
        'platform': _platform,
        'createdAt': DateTime.now().toUtc().toIso8601String(),
      }),
    );

    final parentPid = pid;

    if (Platform.isWindows) {
      final script =
          p.join(exeDir, 'liminald', 'updater', 'relaunch-desktop-windows.ps1');
      await Process.start(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          script,
          '-ParentPid',
          '$parentPid',
          '-ExeDir',
          exeDir,
          '-ArchivePath',
          archive,
        ],
        mode: ProcessStartMode.detached,
      );
    } else {
      final script = p.join(exeDir, 'liminald', 'updater', 'relaunch-desktop.sh');
      await Process.start(
        'bash',
        [script, '$parentPid', exeDir, archive],
        mode: ProcessStartMode.detached,
      );
    }

    exit(0);
  }

  Future<void> dismissBanner() async {
    final version = state.checkResult?.latest.version;
    if (version != null) {
      await savePrefs(prefs.copyWith(dismissedVersion: version));
    }
    notifyListeners();
  }

  Future<void> _runNodeApply({
    required String mode,
    required String exeDir,
    required String archive,
  }) async {
    final script = p.join(exeDir, 'liminald', 'updater', 'apply-desktop-update.mjs');
    if (!File(script).existsSync()) {
      throw Exception('Updater script missing: $script');
    }
    final result = await Process.run(
      'node',
      [script, '--mode', mode, '--exe-dir', exeDir, '--archive', archive],
      runInShell: Platform.isWindows,
    );
    if (result.exitCode != 0) {
      final err = '${result.stderr}'.trim();
      throw Exception(err.isNotEmpty ? err : 'apply-desktop-update failed');
    }
  }

  Future<void> _applyHarnessDart(String exeDir, String archivePath) async {
    final stagingRoot = p.join(exeDir, '.update-staging');
    await Directory(stagingRoot).create(recursive: true);

    final bytes = await File(archivePath).readAsBytes();
    final archive = ZipDecoder().decodeBytes(bytes);
    for (final file in archive) {
      if (!file.name.startsWith('liminald/')) continue;
      final outPath = p.join(stagingRoot, file.name);
      if (file.isFile) {
        await Directory(p.dirname(outPath)).create(recursive: true);
        await File(outPath).writeAsBytes(file.content as List<int>);
      }
    }

    final liminaldStaging = p.join(stagingRoot, 'liminald');
    if (!Directory(liminaldStaging).existsSync()) {
      throw Exception('Archive missing liminald/');
    }

    final target = p.join(exeDir, 'liminald');
    final backup = '$target.bak.${DateTime.now().millisecondsSinceEpoch}';
    final envBackup = p.join(backup, 'repo', '.env');

    if (Directory(target).existsSync()) {
      await Directory(target).rename(backup);
    }
    await Directory(liminaldStaging).rename(target);

    if (File(envBackup).existsSync()) {
      await File(envBackup).copy(p.join(target, 'repo', '.env'));
    }
  }

  @override
  void dispose() {
    _client.close();
    _http.close();
    super.dispose();
  }
}

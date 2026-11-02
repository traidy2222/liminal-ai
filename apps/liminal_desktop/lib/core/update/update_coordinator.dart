import 'dart:async';
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
import 'native_update_helper.dart';

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
    Future<LocalVersions> Function()? loadLocalVersions,
    Future<UpdatePrefs> Function()? readPreferences,
    Future<void> Function(UpdatePrefs)? writePreferences,
    Future<Directory> Function()? temporaryDirectory,
    Future<void> Function(LocalVersions, String)? installAndRestart,
  })  : _client = releaseClient ?? ReleaseClient(client: httpClient),
        _http = httpClient ?? http.Client(),
        _readLocal =
            loadLocalVersions ?? (() => LocalVersions.load(repoRoot: repoRoot)),
        _readPreferences = readPreferences ?? UpdatePrefsService.load,
        _writePreferences = writePreferences ?? UpdatePrefsService.save,
        _temporaryDirectory = temporaryDirectory ?? getTemporaryDirectory,
        _installAndRestart = installAndRestart;

  final String? repoRoot;
  final SidecarShutdown shutdownSidecar;
  final SidecarReboot reboot;
  final ReleaseClient _client;
  final http.Client _http;
  final Future<LocalVersions> Function() _readLocal;
  final Future<UpdatePrefs> Function() _readPreferences;
  final Future<void> Function(UpdatePrefs) _writePreferences;
  final Future<Directory> Function() _temporaryDirectory;
  final Future<void> Function(LocalVersions, String)? _installAndRestart;
  Future<void>? _prefsLoad;
  Future<void> _preferenceWrites = Future<void>.value();
  Future<bool>? _launchTask;
  Completer<bool>? _skipLaunch;
  Completer<void>? _abortLaunch;
  bool _launchWorkRunning = false,
      _launchVisible = false,
      _launchSkipped = false,
      _disposed = false;
  bool get launchUpdateInProgress => _launchVisible;
  bool get canSkipLaunchUpdate =>
      _launchVisible && state.phase != UpdatePhase.applying;
  bool get isBusy =>
      _launchWorkRunning ||
      [UpdatePhase.checking, UpdatePhase.downloading, UpdatePhase.applying]
          .contains(state.phase);
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<bool> runLaunchUpdate() => _launchTask ??= _runLaunchUpdate();
  Future<bool> _runLaunchUpdate() async {
    try {
      await loadPrefs();
      await refreshLocal();
    } catch (e) {
      state = UpdateState(error: e.toString());
      _notify();
      return false;
    }
    if (!shouldAutoCheck) return false;
    _launchVisible = true;
    _launchWorkRunning = true;
    _skipLaunch = Completer<bool>();
    _abortLaunch = Completer<void>();
    _notify();
    try {
      return await Future.any([_performLaunchUpdate(), _skipLaunch!.future]);
    } finally {
      _launchVisible = false;
      _notify();
    }
  }

  Future<bool> _performLaunchUpdate() async {
    try {
      await check(silent: true);
      _checkLaunchAbort();
      final result = state.checkResult;
      if (result == null) return false;
      if (!result.anyUpdate) {
        if (prefs.lastAutomaticAttemptVersion != null)
          await savePrefs(prefs.copyWith(clearAutomaticAttempt: true));
        return false;
      }
      if (!prefs.autoInstallOnLaunch) return false;
      if (prefs.lastAutomaticAttemptVersion == result.latest.version) {
        state = state.copyWith(
            error:
                'An earlier automatic update needs a manual retry in About & updates.');
        return false;
      }
      // One full app archive updates both the interface and bundled harness.
      await downloadApp(forLaunch: true);
      _checkLaunchAbort();
      if (state.appArchivePath == null) return false;
      // From this point a durable install attempt is being scheduled; do not skip
      // between recording the attempt and starting the helper.
      state = state.copyWith(phase: UpdatePhase.applying);
      _notify();
      await savePrefs(
          prefs.copyWith(lastAutomaticAttemptVersion: result.latest.version));
      _checkLaunchAbort();
      return await scheduleAppRestart();
    } catch (e) {
      if (!_launchSkipped && !_disposed) {
        state = state.copyWith(phase: UpdatePhase.error, error: e.toString());
      }
      return false;
    } finally {
      _launchWorkRunning = false;
      _notify();
    }
  }

  void _checkLaunchAbort() {
    if (_launchSkipped || _disposed) throw const _LaunchUpdateSkipped();
  }

  void skipLaunchUpdate() {
    if (!canSkipLaunchUpdate) return;
    _launchSkipped = true;
    if (!(_abortLaunch?.isCompleted ?? true)) _abortLaunch!.complete();
    if (!(_skipLaunch?.isCompleted ?? true)) _skipLaunch!.complete(false);
    state = state.copyWith(
        phase: (state.checkResult?.anyUpdate ?? false)
            ? UpdatePhase.ready
            : UpdatePhase.idle,
        clearError: true);
    _notify();
  }

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

  Future<void> loadPrefs() => _prefsLoad ??= _loadPrefs();
  Future<void> _loadPrefs() async {
    prefs = await _readPreferences();
    _notify();
  }

  Future<void> savePrefs(UpdatePrefs next) async {
    prefs = next;
    final write = _preferenceWrites
        .catchError((Object _) {})
        .then((_) => _writePreferences(next));
    _preferenceWrites = write;
    await write;
    _notify();
  }

  Future<void> refreshLocal() async {
    _local = await _readLocal();
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
        _notify();
      }
      return;
    }

    state = state.copyWith(phase: UpdatePhase.checking, clearError: true);
    _notify();

    try {
      final harness = local.harnessVersion ?? local.appVersion;
      final result = await _client.check(
        appVersion: local.appVersion,
        harnessVersion: harness,
      );
      if (_launchWorkRunning && _launchSkipped) return;
      state = UpdateState(
        phase: result.anyUpdate ? UpdatePhase.ready : UpdatePhase.idle,
        checkResult: result,
      );
      await savePrefs(prefs.copyWith(lastCheckAt: DateTime.now().toUtc()));
    } catch (e) {
      if (_launchWorkRunning && _launchSkipped) return;
      state = state.copyWith(
        phase: silent ? UpdatePhase.idle : UpdatePhase.error,
        error: e.toString(),
      );
    }
    _notify();
  }

  Future<String> _downloadAsset(ReleaseAsset asset,
      {bool forLaunch = false}) async {
    if (p.basename(asset.file) != asset.file)
      throw Exception('Invalid release filename');
    final dir = await _temporaryDirectory();
    final dest = p.join(dir.path, 'liminal-updates', asset.file);
    await Directory(p.dirname(dest)).create(recursive: true);
    final expected = await _client.fetchSha256(asset.sha256Url);
    if (forLaunch) _checkLaunchAbort();
    if (expected == null)
      throw Exception('A valid SHA256 checksum is required for this update.');
    final cached = File(dest);
    if (await cached.exists() &&
        (await sha256.bind(cached.openRead()).first).toString() == expected) {
      if (forLaunch) _checkLaunchAbort();
      return dest;
    }
    final part =
        File('$dest.$pid.${DateTime.now().microsecondsSinceEpoch}.part');
    final abort = Completer<void>();
    IOSink? sink;
    try {
      final request = http.AbortableRequest('GET', Uri.parse(asset.url),
          abortTrigger: forLaunch
              ? Future.any([abort.future, _abortLaunch!.future])
              : abort.future);
      final response =
          await _http.send(request).timeout(const Duration(seconds: 20));
      if (response.statusCode != 200)
        throw Exception('Download failed: ${response.statusCode}');
      sink = part.openWrite();
      final digest = _DigestCollector();
      final hash = sha256.startChunkedConversion(digest);
      var loaded = 0, buffered = 0;
      final progress = Stopwatch()..start();
      final wall = Stopwatch()..start();
      await for (final chunk
          in response.stream.timeout(const Duration(seconds: 20))) {
        if (forLaunch) _checkLaunchAbort();
        if (wall.elapsed > const Duration(minutes: 20))
          throw TimeoutException('Update download timed out');
        loaded += chunk.length;
        buffered += chunk.length;
        sink.add(chunk);
        hash.add(chunk);
        if (buffered >= 1024 * 1024) {
          await sink.flush();
          buffered = 0;
        }
        if (progress.elapsedMilliseconds >= 100 ||
            loaded == response.contentLength) {
          state = state.copyWith(
              phase: UpdatePhase.downloading,
              downloadProgress: (response.contentLength ?? 0) > 0
                  ? (loaded / response.contentLength!).clamp(0, 1).toDouble()
                  : null);
          _notify();
          progress.reset();
        }
      }
      await sink.flush();
      await sink.close();
      sink = null;
      hash.close();
      if (response.contentLength != null && loaded != response.contentLength)
        throw Exception('Update download was interrupted');
      if (digest.value?.toString() != expected)
        throw Exception('SHA256 mismatch for ${asset.file}');
      if (forLaunch) _checkLaunchAbort();
      if (await cached.exists()) await cached.delete();
      await part.rename(dest);
      return dest;
    } finally {
      if (!abort.isCompleted) abort.complete();
      if (sink != null) await sink.close();
      if (await part.exists()) await part.delete();
    }
  }

  Future<void> downloadHarness() async {
    final result = state.checkResult;
    if (result == null || !result.harnessUpdate) return;
    state = state.copyWith(phase: UpdatePhase.downloading, clearError: true);
    _notify();
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
    _notify();
  }

  Future<void> downloadApp({bool forLaunch = false}) async {
    final result = state.checkResult;
    if (result == null ||
        !(result.appUpdate || (forLaunch && result.harnessUpdate))) return;
    final asset = result.latest.platformAssets[_platform];
    if (asset == null) throw Exception('No asset for $_platform');
    state = state.copyWith(phase: UpdatePhase.downloading, clearError: true);
    _notify();
    try {
      final path = await _downloadAsset(asset, forLaunch: forLaunch);
      state = state.copyWith(
        phase: UpdatePhase.ready,
        appArchivePath: path,
        clearError: true,
      );
    } catch (e) {
      if (!forLaunch || !_launchSkipped)
        state = state.copyWith(phase: UpdatePhase.error, error: e.toString());
    }
    _notify();
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
    _notify();

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
    _notify();
  }

  Future<bool> scheduleAppRestart() async {
    try {
      final local = _local ?? await _readLocal();
      if (local.exeDir == null)
        throw Exception('Cannot resolve install directory');
      var archive = state.appArchivePath;
      if (archive == null) {
        await downloadApp();
        archive = state.appArchivePath;
      }
      if (archive == null)
        throw Exception(state.error ?? 'App download failed');
      state = state.copyWith(phase: UpdatePhase.applying, clearError: true);
      _notify();
      final install = _installAndRestart ?? _restartNative;
      await install(local, archive);
      return true;
    } catch (e) {
      state = state.copyWith(phase: UpdatePhase.error, error: e.toString());
      _notify();
      return false;
    }
  }

  Future<void> _restartNative(LocalVersions local, String archive) async {
    final exeDir = local.exeDir!;
    final node = await Process.run('node', ['--version']);
    if (node.exitCode != 0)
      throw Exception('Node.js is required to install updates.');
    final temp = await _temporaryDirectory();
    // The helper must live and run outside the folder it replaces, especially on Windows.
    final helper = Directory(p.join(temp.path,
        'liminal-updater-$pid-${DateTime.now().microsecondsSinceEpoch}'));
    await helper.create(recursive: true);
    for (final name in [
      'relaunch-desktop-windows.ps1',
      'relaunch-desktop.sh',
      'apply-desktop-update.mjs',
      'update-release.mjs',
      'apply-app-swap.mjs',
      'desktop-release-names.mjs'
    ]) {
      await File(p.join(exeDir, 'liminald', 'updater', name))
          .copy(p.join(helper.path, name));
    }
    await File(p.join(exeDir, 'pending_update.json')).writeAsString(jsonEncode({
      'archivePath': archive,
      'platform': _platform,
      'version': state.checkResult?.latest.version,
      'createdAt': DateTime.now().toUtc().toIso8601String()
    }));
    await shutdownSidecar();
    try {
      if (Platform.isWindows) {
        await startWindowsUpdateHelper(
            helperDirectory: helper.path,
            exeDir: exeDir,
            archivePath: archive,
            parentPid: pid);
      } else {
        await Process.start(
            'bash',
            [
              p.join(helper.path, 'relaunch-desktop.sh'),
              '$pid',
              exeDir,
              archive
            ],
            workingDirectory: helper.path,
            mode: ProcessStartMode.detached);
      }
    } catch (_) {
      await reboot();
      rethrow;
    }
    exit(0);
  }

  Future<void> dismissBanner() async {
    final version = state.checkResult?.latest.version;
    if (version != null) {
      await savePrefs(prefs.copyWith(dismissedVersion: version));
    }
    _notify();
  }

  Future<void> _runNodeApply({
    required String mode,
    required String exeDir,
    required String archive,
  }) async {
    final script =
        p.join(exeDir, 'liminald', 'updater', 'apply-desktop-update.mjs');
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
    _disposed = true;
    if (!(_abortLaunch?.isCompleted ?? true)) _abortLaunch!.complete();
    if (!(_skipLaunch?.isCompleted ?? true)) _skipLaunch!.complete(false);
    _client.close();
    _http.close();
    super.dispose();
  }
}

class _LaunchUpdateSkipped implements Exception {
  const _LaunchUpdateSkipped();
}

class _DigestCollector implements Sink<Digest> {
  Digest? value;
  @override
  void add(Digest data) {
    value = data;
  }

  @override
  void close() {}
}

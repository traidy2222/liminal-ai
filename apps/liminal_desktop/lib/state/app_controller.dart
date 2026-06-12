import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';

import '../apps/app_window_manager.dart';
import '../audio/dictation_controller.dart';
import '../audio/sidecar_audio_client.dart';
import '../audio/speech_output.dart';
import '../core/connection_phase.dart';
import '../core/feature_flags.dart';
import '../core/protocol_client.dart';
import '../core/session_registry.dart';
import '../core/sidecar_lifecycle.dart';
import '../models/user_image_attachment.dart';
import '../ui/rich_message/asset_url_resolver.dart';
import '../models/app_config.dart';
import '../models/harness_settings.dart';
import '../models/liminal_app_spec.dart';
import '../models/composer_slash_outcome.dart';
import '../models/integrations_snapshot.dart';
import '../ui/widgets/composer_slash.dart';
import '../models/orchestration_snapshot.dart';
import '../models/terminal_panel_state.dart';
import '../models/terminal_view_state.dart';
import '../models/vireon_account.dart';
import '../protocol/chat_summary.dart';
import '../protocol/frames.dart';
import 'chat_session_controller.dart';
import 'message_models.dart';

export '../core/connection_phase.dart' show ConnectionPhase, AppConnectionPhase;

/// App shell orchestrator: sidecar lifecycle, protocol transport, config, chat list.
///
/// Per-chat transcript state lives in [ChatSessionController] instances via
/// [SessionRegistry] so streaming turns do not rebuild the whole app tree.
class AppController extends ChangeNotifier {
  AppController({this.repoRoot})
      : _sidecar = SidecarLifecycle(repoRoot: repoRoot),
        speechOutput = SpeechOutput(),
        dictation = DictationController() {
    _protocol.onGlobalFrame = _onGlobalFrame;
    _protocol.onChatFrame = _onChatFrame;
    dictation.onSessionActiveChange = _onDictationSessionChange;
    dictation.onCaptureActiveChange = _onDictationCaptureChange;
    dictation.shouldBlockSpeechCapture = () => speechOutput.shouldBlockMicCapture();
    dictation.isTtsPipelineActive = () => speechOutput.isTtsPipelineActive;
    dictation.onBargeIn = speechOutput.interrupt;
    speechOutput.onPlaybackHoldChange = _applyTtsPlaybackHold;
    speechOutput.onMicCaptureUnblocked = () {
      if (dictationSessionActive) {
        unawaited(dictation.reconcileListening());
      }
    };
    speechOutput.addListener(notifyListeners);
    dictation.addListener(notifyListeners);
    _appWindows.bindMainWindowHandler();
  }

  final String? repoRoot;

  final SidecarLifecycle _sidecar;
  final ProtocolClient _protocol = ProtocolClient();
  final SessionRegistry _sessions = SessionRegistry();
  late final AppWindowManager _appWindows = AppWindowManager(
    resolveAccentHex: () => _accentHex,
    resolveSidecarPort: () => _sidecarPort,
    resolveSidecarToken: () => _sidecarToken,
    onRefresh: refreshDesktopApp,
  );
  bool _desktopAppsBootPending = false;
  int? _sidecarPort;
  String? _sidecarToken;

  ConnectionPhase phase = ConnectionPhase.idle;
  String? bootError;
  AppConfig? config;
  bool configLoading = false;
  bool sidecarReady = false;
  String? sidecarInitError;
  String? setupError;
  bool setupSaving = false;
  HarnessSettingsSnapshot? harnessSettings;
  bool harnessSettingsLoading = false;
  ManagedInferenceModelsCatalog? managedInferenceModels;
  bool managedInferenceModelsLoading = false;
  String? managedInferenceModelsError;
  VireonAccountSnapshot vireonAccount = VireonAccountSnapshot.empty;
  bool vireonAccountLoading = false;
  bool vireonAuthBusy = false;
  String? vireonAuthError;

  /// Harness internals in the transcript (trace, working state, retries). Tool
  /// activity rows always show; this only toggles verbose tool args/output.
  bool showRawHarness = false;

  final DictationController dictation;
  final SpeechOutput speechOutput;
  bool dictationSessionActive = false;
  bool dictationCaptureActive = false;
  String? dictationNotice;
  String? _pendingDictationMessage;
  Future<void> _ttsHoldChain = Future.value();

  int? get sidecarPort => _sidecarPort;
  String? get sidecarToken => _sidecarToken;

  void setShowRawHarness(bool value) {
    if (showRawHarness == value) return;
    showRawHarness = value;
    notifyListeners();
  }

  void toggleShowRawHarness() => setShowRawHarness(!showRawHarness);

  int get protocolVersion => _protocol.protocolVersion;
  String get sidecarVersion => _protocol.sidecarVersion;

  String? activeChatId;
  /// Chats shown in the main area (up to [maxVisibleChats] panes). [activeChatId] is focused.
  List<String> visibleChatIds = [];
  /// False on the Vireon hub; true while the chat workspace route is open.
  bool inChatWorkspace = false;
  /// Set by `LIMINAL_MARKETING_CAPTURE=1` when spawned from capture scripts.
  bool get marketingCaptureMode =>
      Platform.environment['LIMINAL_MARKETING_CAPTURE'] == '1';
  static const maxVisibleChats = 10;
  List<ChatSummary> chats = [];
  List<LiminalAppSpec> desktopApps = [];
  Map<String, AppCacheEntry> desktopAppCaches = {};
  bool desktopAppsLoading = false;
  OrchestrationSnapshot orchestration = OrchestrationSnapshot.empty;
  bool orchestrationBusy = false;

  IntegrationsSnapshot integrations = IntegrationsSnapshot.empty;
  bool integrationsLoading = false;
  bool integrationsBusy = false;
  String? integrationsError;
  Timer? _integrationsPollTimer;

  bool get needsProviderSetup => config != null && !config!.apiKeyConfigured;
  bool get needsPersonaBootstrap =>
      config != null && config!.personaBootstrapPending;

  ChatSessionController sessionFor(String chatId) => _sessions.sessionFor(chatId);

  ChatSessionController? get activeSession =>
      activeChatId != null ? _sessions.get(activeChatId!) : null;

  Future<void> boot() async {
    if (phase == ConnectionPhase.booting) return;
    phase = ConnectionPhase.booting;
    bootError = null;
    configLoading = true;
    sidecarReady = false;
    sidecarInitError = null;
    notifyListeners();

    try {
      final proc = await _sidecar.ensureRunning(
        attachToExisting: SidecarLifecycle.attachFromEnv,
      );
      _sidecarPort = proc.port;
      _sidecarToken = proc.token;
      await _protocol.connect(port: proc.port, token: proc.token);
      _syncAssetResolver();
      await _protocol.waitForSidecarReady();
      _syncDictationAudioClient();
      if (!sidecarReady) {
        sidecarReady = true;
      }

      phase = ConnectionPhase.connected;
      if (LiminalFeatureFlags.desktopAppsEnabled) {
        await _appWindows.ensureChannelReady();
      }
      if (config == null) {
        await refreshConfig();
      } else {
        configLoading = false;
      }
      notifyListeners();
    } catch (e) {
      phase = ConnectionPhase.error;
      bootError = e.toString();
      configLoading = false;
      notifyListeners();
    }
  }

  void _applyConfigFromJson(Map<String, dynamic>? json) {
    if (json == null) return;
    config = AppConfig.fromJson(json);
    configLoading = false;
    _syncVoiceFromConfig();
  }

  String get _accentHex {
    final accent = config?.resolvedTheme.accent;
    if (accent == null) return '#6EE7B7';
    final argb = accent.toARGB32();
    return '#${(argb & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';
  }

  void _syncVoiceFromConfig() {
    final cfg = config;
    if (cfg == null) return;
    speechOutput.setTtsConfigured(cfg.ttsEnabled);
    dictation.endpointOptions = DictationEndpointOptions.fromAppConfig(
      minRecordingMs: cfg.dictationMinRecordingMs,
      silenceMsShort: cfg.dictationSilenceMsShort,
      silenceMsLong: cfg.dictationSilenceMsLong,
      maxRecordingMs: cfg.dictationMaxRecordingMs,
      audioCue: cfg.dictationAudioCue,
    );
  }

  SidecarAudioClient? _audioClientForActiveChat() {
    final chatId = activeChatId;
    final port = _sidecarPort;
    final token = _sidecarToken;
    if (chatId == null || port == null || token == null) return null;
    return SidecarAudioClient(port: port, token: token, chatId: chatId);
  }

  void _syncDictationAudioClient() {
    final client = _audioClientForActiveChat();
    dictation.bindAudioClient(client);
    speechOutput.setClipFetcher(
      client == null ? null : (url) => client.fetchTtsClip(url),
    );
  }

  void _onDictationSessionChange() {
    dictationSessionActive = dictation.sessionActive;
    if (dictationSessionActive) {
      unawaited(speechOutput.unlockAudio());
    } else {
      speechOutput.flush();
    }
    notifyListeners();
  }

  void _onDictationCaptureChange(bool active) {
    dictationCaptureActive = active;
    speechOutput.setPauseWhenCapture(active);
    notifyListeners();
  }

  void _applyTtsPlaybackHold(bool hold) {
    _ttsHoldChain = _ttsHoldChain.then((_) async {
      if (hold) {
        await dictation.suspendForTts();
      } else {
        await dictation.resumeAfterTts();
        if (dictationSessionActive) {
          await dictation.reconcileListening();
        }
      }
    });
    unawaited(_ttsHoldChain);
  }

  void _onChatFrame(String chatId, String event, Map<String, dynamic> data) {
    if (event == 'terminal_view') {
      _applyTerminalView(chatId, data);
    }
    if (chatId == activeChatId) {
      _syncAssetResolver(chatId: chatId);
    }
    if (event == 'speech' && chatId == activeChatId && dictationSessionActive) {
      _handleSpeechEvent(data);
    }
    if (event == 'harness_running' && marketingCaptureMode) {
      if (!inChatWorkspace || activeChatId != chatId) {
        unawaited(enterChatWorkspace(chatId));
      }
    }
    if (event == 'turn_end' && chatId == activeChatId) {
      unawaited(_flushPendingDictationSend());
      if (dictationSessionActive) {
        unawaited(dictation.reconcileListening());
        Future.delayed(const Duration(milliseconds: 1400), () {
          if (dictationSessionActive) {
            unawaited(dictation.reconcileListening());
          }
        });
      }
    }
    if (event == 'tool_approval' &&
        chatId == activeChatId &&
        dictationSessionActive) {
      dictationNotice = 'Approval required — review the prompt above.';
      notifyListeners();
    }
    _sessions.dispatch(chatId, event, data);
    if (event == 'transcript_replay' && visibleChatIds.contains(chatId)) {
      notifyListeners();
    }
    if (visibleChatIds.contains(chatId) &&
        (event == 'tool_start' ||
            event == 'tool_delta' ||
            event == 'compose_preview' ||
            event == 'tool_result' ||
            event == 'turn_end')) {
      notifyListeners();
    }
  }

  void _handleSpeechEvent(Map<String, dynamic> data) {
    final clipId = data['clipId'] as String? ?? '';
    final text = data['text'] as String? ?? '';
    final audioUrl = data['audioUrl'] as String? ?? '';
    if (clipId.isEmpty || audioUrl.isEmpty) return;
    // Server already synthesized — play whenever voice mode is on (matches web SSE).
    speechOutput.enqueue(
      SpeechQueueItem(clipId: clipId, text: text, audioUrl: audioUrl),
    );
  }

  void dismissDictationNotice() {
    dictationNotice = null;
    notifyListeners();
  }

  /// `null` = sent; `queued` = held until turn ends; else error text.
  Future<String?> handleDictationAutoSend(String fullMessage) async {
    final trimmed = fullMessage.trim();
    if (trimmed.isEmpty) return 'Empty transcript — nothing to send.';
    if (activeSession?.busy == true) {
      _pendingDictationMessage = trimmed;
      dictationNotice = 'Agent busy — message queued.';
      notifyListeners();
      return 'queued';
    }
    dictationNotice = null;
    final ok = await sendMessage(trimmed, liveDictation: true);
    if (!ok) return 'Send failed — message kept in composer.';
    return null;
  }

  Future<void> _flushPendingDictationSend() async {
    final pending = _pendingDictationMessage;
    if (pending == null) return;
    if (activeSession?.busy == true) return;
    _pendingDictationMessage = null;
    dictationNotice = null;
    notifyListeners();
    await sendMessage(pending, liveDictation: dictationSessionActive);
  }

  Future<void> refreshConfig() async {
    if (!_protocol.isConnected) {
      configLoading = false;
      return;
    }
    configLoading = true;
    notifyListeners();
    try {
      final result = await _protocol.send(
        'get_config',
        {},
        timeout: const Duration(seconds: 30),
      );
      if (result.ok && result.data is Map) {
        _applyConfigFromJson(Map<String, dynamic>.from(result.data! as Map));
      } else if (config == null) {
        setupError = result.error ?? 'Could not load configuration';
      }
    } catch (e) {
      if (config == null) setupError = e.toString();
    } finally {
      configLoading = false;
      notifyListeners();
    }
  }

  void _applyVireonFromJson(Map<String, dynamic>? json) {
    if (json == null) return;
    vireonAccount = VireonAccountSnapshot.fromJson(json);
    vireonAuthError = null;
  }

  Future<void> loadVireonAccount() async {
    if (!_protocol.isConnected) return;
    vireonAccountLoading = true;
    notifyListeners();
    try {
      final result = await _protocol.send(
        'get_vireon_account',
        {},
        timeout: const Duration(seconds: 30),
      );
      if (result.ok && result.data is Map) {
        _applyVireonFromJson(Map<String, dynamic>.from(result.data! as Map));
      }
    } finally {
      vireonAccountLoading = false;
      notifyListeners();
    }
  }

  Future<bool> signInToVireon() async {
    if (!_protocol.isConnected || vireonAuthBusy) return false;
    vireonAuthBusy = true;
    vireonAuthError = null;
    notifyListeners();
    try {
      final result = await _protocol.send(
        'vireon_sign_in',
        {'openBrowser': true},
        timeout: const Duration(minutes: 6),
      );
      if (!result.ok) {
        vireonAuthError = result.error ?? 'Sign-in failed';
        return false;
      }
      if (result.data is Map) {
        final map = Map<String, dynamic>.from(result.data! as Map);
        final appConfig = map.remove('appConfig');
        _applyVireonFromJson(map);
        if (appConfig is Map) {
          _applyConfigFromJson(Map<String, dynamic>.from(appConfig));
        }
      }
      await loadHarnessSettings();
      await refreshConfig();
      await loadManagedInferenceModels();
      return vireonAccount.connected;
    } catch (e) {
      vireonAuthError = e.toString();
      return false;
    } finally {
      vireonAuthBusy = false;
      notifyListeners();
    }
  }

  Future<bool> signOutOfVireon() async {
    if (!_protocol.isConnected || vireonAuthBusy) return false;
    vireonAuthBusy = true;
    vireonAuthError = null;
    notifyListeners();
    try {
      final result = await _protocol.send(
        'vireon_sign_out',
        {},
        timeout: const Duration(seconds: 30),
      );
      if (!result.ok) {
        vireonAuthError = result.error ?? 'Sign-out failed';
        return false;
      }
      if (result.data is Map) {
        _applyVireonFromJson(Map<String, dynamic>.from(result.data! as Map));
      } else {
        vireonAccount = VireonAccountSnapshot.empty;
      }
      await loadHarnessSettings();
      await refreshConfig();
      managedInferenceModels = null;
      managedInferenceModelsError = null;
      return true;
    } catch (e) {
      vireonAuthError = e.toString();
      return false;
    } finally {
      vireonAuthBusy = false;
      notifyListeners();
    }
  }

  Future<void> loadHarnessSettings({bool reconnectVireon = false}) async {
    if (!_protocol.isConnected) return;
    harnessSettingsLoading = true;
    notifyListeners();
    try {
      if (reconnectVireon && vireonAccount.connected) {
        final reconnect = await _protocol.send(
          'vireon_reconnect',
          {},
          timeout: const Duration(seconds: 30),
        );
        if (reconnect.ok && reconnect.data is Map) {
          final map = Map<String, dynamic>.from(reconnect.data! as Map);
          final appConfig = map.remove('appConfig');
          _applyVireonFromJson(map);
          if (appConfig is Map) {
            _applyConfigFromJson(Map<String, dynamic>.from(appConfig));
          }
        }
      }
      final result = await _protocol.send(
        'get_settings',
        {},
        timeout: const Duration(seconds: 30),
      );
      if (result.ok && result.data is Map) {
        harnessSettings = HarnessSettingsSnapshot.fromJson(
          Map<String, dynamic>.from(result.data! as Map),
        );
      }
    } finally {
      harnessSettingsLoading = false;
      notifyListeners();
    }
  }

  Future<void> loadManagedInferenceModels() async {
    final showManaged = harnessSettings?.provider.showManagedInference == true;
    if (!_protocol.isConnected || !vireonAccount.connected || !showManaged) {
      managedInferenceModels = null;
      managedInferenceModelsError = null;
      managedInferenceModelsLoading = false;
      notifyListeners();
      return;
    }
    managedInferenceModelsLoading = true;
    managedInferenceModelsError = null;
    notifyListeners();
    try {
      final result = await _protocol.send(
        'get_vireon_inference_models',
        {},
        timeout: const Duration(seconds: 45),
      );
      if (result.ok && result.data is Map) {
        managedInferenceModels = ManagedInferenceModelsCatalog.fromJson(
          Map<String, dynamic>.from(result.data! as Map),
        );
      } else {
        managedInferenceModels = null;
        managedInferenceModelsError = result.error ?? 'Failed to load managed models';
      }
    } catch (e) {
      managedInferenceModels = null;
      managedInferenceModelsError = e.toString();
    } finally {
      managedInferenceModelsLoading = false;
      notifyListeners();
    }
  }

  Future<bool> patchManagedInferenceModels({
    String? mainModel,
    String? fastModel,
  }) async {
    if (!_protocol.isConnected) return false;
    final envPatch = <String, String>{};
    if (mainModel != null && mainModel.trim().isNotEmpty) {
      envPatch['AGENT_MODEL'] = mainModel.trim();
    }
    if (fastModel != null && fastModel.trim().isNotEmpty) {
      envPatch['AGENT_FAST_MODEL'] = fastModel.trim();
    }
    if (envPatch.isEmpty) return false;

    final providerPatch = <String, String>{};
    if (mainModel != null && mainModel.trim().isNotEmpty) {
      providerPatch['model'] = mainModel.trim();
    }

    final result = await _protocol.send('update_settings', {
      'patch': {
        'harness': {'env': envPatch},
        if (providerPatch.isNotEmpty) 'provider': providerPatch,
      },
    });
    if (result.ok) {
      await loadHarnessSettings();
      await refreshConfig();
    }
    return result.ok;
  }

  Future<bool> patchHarnessSettings(Map<String, String> envPatch) async {
    if (!_protocol.isConnected || envPatch.isEmpty) return false;
    final result = await _protocol.send('update_settings', {
      'patch': {
        'harness': {'env': envPatch},
      },
    });
    if (result.ok) {
      await loadHarnessSettings();
      await refreshConfig();
    }
    return result.ok;
  }

  /// Apply a provider model pack (main, fast, routing) from Settings preset dropdown.
  Future<bool> applyProviderPreset(String presetId) async {
    if (!_protocol.isConnected || presetId.isEmpty || presetId == 'custom') {
      return false;
    }
    final snap = harnessSettings;
    if (snap == null) return false;
    ProviderPreset? preset;
    for (final p in snap.providerPresets) {
      if (p.id == presetId) {
        preset = p;
        break;
      }
    }
    if (preset == null || preset.baseURL.isEmpty) return false;
    if (snap.provider.presetLockedByEnv) return false;

    final envPatch = <String, String>{};
    final merge = <String, String>{
      'AGENT_MODEL': preset.model,
      if (preset.harnessEnvPatch != null) ...preset.harnessEnvPatch!,
    };
    if (preset.baseURL.isNotEmpty) {
      merge['AGENT_API_BASE_URL'] = preset.baseURL;
    }
    for (final entry in merge.entries) {
      final locked = snap.fields.any((f) => f.key == entry.key && f.lockedByEnv);
      if (locked) continue;
      envPatch[entry.key] = entry.value;
    }

    final result = await _protocol.send('update_settings', {
      'patch': {
        'harness': {'env': envPatch},
        'provider': {
          'model': preset.model,
          'baseURL': preset.baseURL,
        },
      },
    });
    if (result.ok) {
      await loadHarnessSettings();
      await refreshConfig();
    } else {
      setupError = result.error ?? 'Failed to apply provider preset';
      notifyListeners();
    }
    return result.ok;
  }

  Future<bool> saveProvider({
    required String apiKey,
    String? model,
    String? baseUrl,
    bool requireApiKey = true,
  }) async {
    if (!_protocol.isConnected) return false;
    if (requireApiKey && apiKey.trim().length < 8) {
      setupError = 'API key is too short';
      notifyListeners();
      return false;
    }
    setupSaving = true;
    setupError = null;
    notifyListeners();
    final body = <String, dynamic>{
      if (apiKey.trim().isNotEmpty) 'apiKey': apiKey.trim(),
      if (model != null && model.trim().isNotEmpty) 'model': model.trim(),
      if (baseUrl != null && baseUrl.trim().isNotEmpty) 'baseURL': baseUrl.trim(),
    };
    final result = await _protocol.send('save_provider', body);
    setupSaving = false;
    if (!result.ok) {
      setupError = result.error ?? 'Failed to save provider';
      notifyListeners();
      return false;
    }
    if (result.data is Map) {
      _applyConfigFromJson(Map<String, dynamic>.from(result.data! as Map));
    } else {
      await refreshConfig();
    }
    notifyListeners();
    return true;
  }

  Future<bool> submitPersonaBootstrap(String input, {bool skip = false}) async {
    final chatId = activeChatId;
    if (!_protocol.isConnected || chatId == null) return false;
    setupSaving = true;
    setupError = null;
    notifyListeners();
    final result = await _protocol.send(
      'submit_persona_bootstrap',
      {
        'chatId': chatId,
        'input': input,
        if (skip) 'skip': true,
      },
      timeout: const Duration(minutes: 5),
    );
    setupSaving = false;
    if (!result.ok) {
      setupError = result.error ?? 'Persona setup failed';
      notifyListeners();
      return false;
    }
    if (result.data is Map) {
      _applyConfigFromJson(Map<String, dynamic>.from(result.data! as Map));
    } else {
      await refreshConfig();
    }
    notifyListeners();
    return true;
  }

  void _onGlobalFrame(ServerFrame frame) {
    switch (frame.event) {
      case 'hello':
        final starting = frame.data['starting'] as bool? ?? false;
        if (!starting) {
          _applyHelloPayload(frame.data);
        }
        notifyListeners();
        return;
      case 'sidecar_ready':
        _applyHelloPayload(frame.data);
        sidecarInitError = frame.data['initError'] as String?;
        sidecarReady = true;
        _desktopAppsBootPending = true;
        notifyListeners();
        return;
      case 'app_list':
        if (!LiminalFeatureFlags.desktopAppsEnabled) return;
        _applyAppList(frame.data, openAuto: _desktopAppsBootPending);
        _desktopAppsBootPending = false;
        notifyListeners();
        return;
      case 'app_spawned':
        if (!LiminalFeatureFlags.desktopAppsEnabled) return;
        final appJson = frame.data['app'];
        if (appJson is Map) {
          final spec = LiminalAppSpec.fromJson(Map<String, dynamic>.from(appJson));
          _upsertDesktopApp(spec);
          if (spec.autoOpen && !_appWindows.isOpen(spec.id)) {
            unawaited(_appWindows.openWindow(spec));
          }
        }
        notifyListeners();
        return;
      case 'app_updated':
        if (!LiminalFeatureFlags.desktopAppsEnabled) return;
        final updatedJson = frame.data['app'];
        if (updatedJson is Map) {
          final spec = LiminalAppSpec.fromJson(Map<String, dynamic>.from(updatedJson));
          _upsertDesktopApp(spec);
        }
        notifyListeners();
        return;
      case 'pty_exit': {
        final chatId = frame.chatId ?? frame.data['chatId'] as String?;
        final sessionId = frame.data['sessionId'] as String?;
        if (chatId == null || sessionId == null) return;
        _sessions.get(chatId)?.removeTerminalTab(sessionId);
        notifyListeners();
        return;
      }
      case 'app_closed':
        if (!LiminalFeatureFlags.desktopAppsEnabled) return;
        final appId = frame.data['appId'] as String? ?? '';
        if (appId.isNotEmpty) {
          desktopApps = desktopApps.where((a) => a.id != appId).toList();
          desktopAppCaches.remove(appId);
          _appWindows.removeApp(appId);
          unawaited(_appWindows.closeWindow(appId));
        }
        notifyListeners();
        return;
      case 'app_data':
        if (!LiminalFeatureFlags.desktopAppsEnabled) return;
        final appId = frame.data['appId'] as String? ?? '';
        final cacheJson = frame.data['cache'];
        if (appId.isNotEmpty && cacheJson is Map) {
          final cache = AppCacheEntry.fromJson(Map<String, dynamic>.from(cacheJson));
          desktopAppCaches[appId] = cache;
          _appWindows.updateCache(appId, cache);
        }
        notifyListeners();
        return;
      case 'chat_list':
        activeChatId = frame.data['activeChatId'] as String?;
        chats = _parseChats(frame.data['chats']);
        _pruneVisibleChats();
        _ensureVisibleInitialized();
        if (marketingCaptureMode &&
            activeChatId != null &&
            !inChatWorkspace) {
          unawaited(enterChatWorkspace(activeChatId!));
        }
        _syncAssetResolver();
        _syncDictationAudioClient();
        _syncPersonaPendingFromActiveChat();
        notifyListeners();
        return;
      case 'settings':
        final values = frame.data['values'];
        if (values is Map) {
          harnessSettings = HarnessSettingsSnapshot.fromJson(
            Map<String, dynamic>.from(values),
          );
          notifyListeners();
        }
        return;
      case 'vireon_account':
        _applyVireonFromJson(frame.data);
        notifyListeners();
        return;
      case 'orchestration_status':
        orchestration = OrchestrationSnapshot.fromJson(frame.data);
        notifyListeners();
        return;
      default:
        return;
    }
  }

  void _applyHelloPayload(Map<String, dynamic> data) {
    activeChatId = data['activeChatId'] as String?;
    chats = _parseChats(data['chats']);
    _syncAssetResolver();
    _syncDictationAudioClient();
    final appConfig = data['appConfig'];
    if (appConfig is Map) {
      _applyConfigFromJson(Map<String, dynamic>.from(appConfig));
    }
    sidecarReady = true;
    final chatId = activeChatId;
    if (chatId != null && _protocol.isConnected) {
      // Sidecar also unicasts replay after `sidecar_ready`; this command is the
      // fallback when that frame was missed or the payload was too large.
      unawaited(_ensureTranscriptReplayed(chatId));
    }
  }

  Future<void> _ensureTranscriptReplayed(String chatId) async {
    final session = _sessions.get(chatId);
    if (session != null && session.messages.isNotEmpty) return;
    final result = await _protocol.send('replay_transcript', {'chatId': chatId});
    if (result.ok) notifyListeners();
  }

  void _syncAssetResolver({String? chatId}) {
    final port = _sidecarPort;
    final token = _sidecarToken;
    if (port == null || token == null) return;
    assetUrlResolver.configure(
      port: port,
      token: token,
      chatId: chatId ?? activeChatId,
    );
  }

  void _syncPersonaPendingFromActiveChat() {
    if (config == null) return;
    ChatSummary? active;
    for (final c in chats) {
      if (c.active) {
        active = c;
        break;
      }
    }
    if (active == null) return;
          config = config!.copyWith(
            personaBootstrapPending: active.awaitingPersonaBootstrap,
          );
  }

  List<ChatSummary> _parseChats(dynamic raw) {
    return (raw as List<dynamic>? ?? [])
        .map((e) => ChatSummary.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  Future<bool> sendMessage(
    String text, {
    String? chatId,
    bool freshContext = false,
    List<UserImageAttachment> attachments = const [],
    bool liveDictation = false,
    String? workflowPreset,
  }) async {
    final targetChatId = chatId ?? activeChatId;
    if (targetChatId == null || !_protocol.isConnected) return false;
    final trimmed = text.trim();
    if (trimmed.isEmpty && attachments.isEmpty) return false;
    if (needsProviderSetup || needsPersonaBootstrap) return false;

    _syncAssetResolver(chatId: targetChatId);
    unawaited(speechOutput.unlockAudio());
    if (liveDictation || dictationSessionActive) {
      speechOutput.flush();
    }

    final previews = [
      for (final a in attachments) UserAttachmentPreview(name: a.name),
    ];
    _sessions.sessionFor(targetChatId).applyUserMessage(
      trimmed,
      attachmentPreviews: previews,
    );
    final result = await _protocol.send('send_message', {
      'chatId': targetChatId,
      'message': trimmed,
      if (freshContext) 'freshContext': true,
      if (liveDictation || dictationSessionActive) 'liveDictation': true,
      if (workflowPreset != null) 'workflowPreset': workflowPreset,
      if (attachments.isNotEmpty)
        'attachments': attachments.map((a) => a.toWire()).toList(),
    });
    if (!result.ok) {
      _sessions.sessionFor(targetChatId).setConnectionError(
        result.error ?? 'send_message failed',
      );
      return false;
    }
    return true;
  }

  Future<void> abortTurn({String? chatId}) async {
    final id = chatId ?? activeChatId;
    if (id == null || !_protocol.isConnected) return;
    await _protocol.send('abort', {'chatId': id});
  }

  String? _terminalEmbedUrl(String sessionId) {
    final port = _sidecarPort;
    final token = _sidecarToken;
    if (port == null || token == null) return null;
    return 'http://127.0.0.1:$port/terminal/embed?token=${Uri.encodeComponent(token)}'
        '&sessionId=${Uri.encodeComponent(sessionId)}&port=$port';
  }

  void _applyTerminalView(String chatId, Map<String, dynamic> data) {
    final session = _sessions.get(chatId);
    if (session == null) return;
    final wire = TerminalViewWire.fromJson(data);
    if (!wire.open) {
      if (wire.sessionId.isNotEmpty) {
        session.removeTerminalTab(wire.sessionId);
      } else {
        session.setTerminalPanel(null);
      }
      notifyListeners();
      return;
    }
    final embedUrl = _terminalEmbedUrl(wire.sessionId);
    if (embedUrl == null || wire.sessionId.isEmpty) return;
    session.upsertTerminalTab(
      TerminalTabState(
        sessionId: wire.sessionId,
        embedUrl: embedUrl,
        cwd: wire.cwd,
        label: wire.label,
        source: wire.source,
      ),
      focus: wire.focus,
    );
    notifyListeners();
  }

  /// Toggle terminal dock visibility; opens a user shell when none exist.
  Future<void> toggleChatTerminal(String chatId) async {
    final session = _sessions.get(chatId);
    if (session == null || !_protocol.isConnected) return;

    final panel = session.terminalPanel;
    if (panel != null && panel.hasTabs) {
      session.terminalDockExpanded = !session.terminalDockExpanded;
      notifyListeners();
      return;
    }

    await openChatTerminalTab(chatId, forceNew: false);
  }

  /// Open a user terminal tab (reuses primary when [forceNew] is false).
  Future<void> openChatTerminalTab(
    String chatId, {
    bool forceNew = true,
  }) async {
    final session = _sessions.get(chatId);
    if (session == null || !_protocol.isConnected) return;

    final result = await _protocol.send('pty_open', {
      'chatId': chatId,
      'cols': 100,
      'rows': 28,
      'source': 'user',
      if (forceNew) 'forceNew': true,
    });
    if (!result.ok) return;
    final data = result.data;
    if (data is! Map) return;
    final map = Map<String, dynamic>.from(data);
    final sessionId = map['sessionId'] as String? ?? '';
    if (sessionId.isEmpty) return;
    final embedUrl = _terminalEmbedUrl(sessionId);
    if (embedUrl == null) return;
    session.upsertTerminalTab(
      TerminalTabState(
        sessionId: sessionId,
        embedUrl: embedUrl,
        cwd: map['cwd'] as String? ?? '',
        label: map['label'] as String? ?? 'Terminal',
        source: map['source'] as String? ?? 'user',
      ),
      focus: true,
    );
    notifyListeners();
  }

  Future<void> closeChatTerminalTab(String chatId, String sessionId) async {
    final session = _sessions.get(chatId);
    if (session == null || !_protocol.isConnected) return;
    await _protocol.send('pty_close', {'sessionId': sessionId});
    session.removeTerminalTab(sessionId);
    notifyListeners();
  }

  Future<void> resolveApproval(
    String decision, {
    String? chatId,
    String? reason,
  }) async {
    final targetChatId = chatId ?? activeChatId;
    final session =
        targetChatId != null ? _sessions.get(targetChatId) : null;
    final pending = session?.pendingApproval;
    if (targetChatId == null || !_protocol.isConnected || pending == null) {
      return;
    }

    final approvalPayload = decision == 'approve'
        ? {'decision': 'approve'}
        : {
            'decision': 'reject',
            'reason': reason?.trim().isNotEmpty == true
                ? reason!.trim()
                : 'user declined',
          };
    final result = await _protocol.send('resolve_approval', {
      'chatId': targetChatId,
      'callId': pending.callId,
      'approvalNonce': pending.approvalNonce,
      'decision': approvalPayload,
    });
    if (!result.ok) return;
    session!.applyServerEvent('approval_decision', {
      'callId': pending.callId,
      'decision': decision == 'approve' ? 'approve' : 'reject',
    });
  }

  Future<void> resolveAskUser(String answer, {String? chatId}) async {
    final id = chatId ?? activeChatId;
    if (id == null || !_protocol.isConnected) return;
    await _protocol.send('resolve_ask_user', {
      'chatId': id,
      'answer': answer,
    });
    _sessions.get(id)?.applyServerEvent('ask_user_answered', {});
  }

  String? get orchestratorChatId {
    for (final c in chats) {
      if (c.isOrchestrator) return c.chatId;
    }
    return null;
  }

  bool isOrchestratorChat(String chatId) =>
      chats.any((c) => c.chatId == chatId && c.isOrchestrator);

  Future<String?> openOrchestratorChat() async {
    if (!_protocol.isConnected) return null;
    final result = await _protocol.send('get_or_create_orchestrator_chat', {});
    if (!result.ok || result.data is! Map) return null;
    final chatId = (result.data as Map)['chatId'] as String?;
    if (chatId == null || chatId.isEmpty) return null;
    await refreshConfig();
    await enterChatWorkspace(chatId);
    return chatId;
  }

  Future<void> loadIntegrations() async {
    if (!_protocol.isConnected) return;
    integrationsLoading = true;
    integrationsError = null;
    notifyListeners();
    try {
      final ok = await _refreshIntegrationsFromServer();
      if (!ok) {
        integrationsError ??= 'Failed to load integrations';
      }
    } catch (e) {
      integrationsError = e.toString();
    } finally {
      integrationsLoading = false;
      notifyListeners();
    }
  }

  Future<bool> _refreshIntegrationsFromServer() async {
    if (!_protocol.isConnected) return false;
    final result = await _protocol.send(
      'get_integrations',
      {},
      timeout: const Duration(seconds: 30),
    );
    if (result.ok && result.data is Map) {
      integrations = IntegrationsSnapshot.fromJson(
        _coerceJsonMap(result.data! as Map),
      );
      return true;
    }
    integrationsError = result.error ?? integrationsError;
    return false;
  }

  Map<String, dynamic> _coerceJsonMap(Map raw) {
    return Map<String, dynamic>.from(raw);
  }

  void _applyIntegrationsPayload(Map<String, dynamic>? json) {
    if (json == null) return;
    final nested = json['integrations'];
    if (nested is Map) {
      integrations = IntegrationsSnapshot.fromJson(_coerceJsonMap(nested));
      return;
    }
    if (json.containsKey('google') && json.containsKey('connections')) {
      integrations = IntegrationsSnapshot.fromJson(json);
    }
  }

  bool _isLongRunningIntegrationCommand(String command) {
    return command == 'connect_google_oauth' ||
        command == 'connect_microsoft_oauth' ||
        command == 'connect_azure_oauth' ||
        command == 'connect_xero_oauth' ||
        command == 'connect_slack_oauth' ||
        command == 'connect_linear_oauth' ||
        command == 'connect_notion_oauth' ||
        command == 'connect_github_oauth';
  }

  void _startIntegrationsPolling() {
    _integrationsPollTimer?.cancel();
    _integrationsPollTimer = Timer.periodic(const Duration(milliseconds: 1500), (_) {
      unawaited(_refreshIntegrationsFromServer().then((ok) {
        if (ok) notifyListeners();
      }));
    });
  }

  void _stopIntegrationsPolling() {
    _integrationsPollTimer?.cancel();
    _integrationsPollTimer = null;
  }

  Future<bool> _runIntegrationCommand(
    String command,
    Map<String, dynamic> payload,
  ) async {
    if (!_protocol.isConnected || integrationsBusy) return false;
    integrationsBusy = true;
    integrationsError = null;
    notifyListeners();
    final pollWhileRunning = _isLongRunningIntegrationCommand(command);
    if (pollWhileRunning) _startIntegrationsPolling();
    try {
      final result = await _protocol.send(
        command,
        payload,
        timeout: pollWhileRunning
            ? const Duration(minutes: 11)
            : const Duration(seconds: 120),
      );
      if (result.ok && result.data is Map) {
        final data = Map<String, dynamic>.from(result.data! as Map);
        _applyIntegrationsPayload(data);
        await _refreshIntegrationsFromServer();
        final attachOutput = data['attachOutput'] as String?;
        if (attachOutput != null &&
            attachOutput.trim().isNotEmpty &&
            (attachOutput.contains('failed') ||
                attachOutput.contains('Skipped') ||
                attachOutput.contains('Partial') ||
                attachOutput.contains('error') ||
                attachOutput.contains('busy'))) {
          integrationsError = attachOutput;
        }
        notifyListeners();
        return true;
      }
      integrationsError = result.error ?? 'Integration command failed';
      return false;
    } catch (e) {
      integrationsError = e.toString();
      return false;
    } finally {
      if (pollWhileRunning) _stopIntegrationsPolling();
      integrationsBusy = false;
      notifyListeners();
    }
  }

  Future<bool> connectGoogleOAuth({
    List<String>? services,
    String mode = 'read_write',
  }) =>
      _runIntegrationCommand('connect_google_oauth', {
        if (services != null) 'services': services,
        'mode': mode,
        'openBrowser': true,
      });

  Future<bool> connectGoogleWorkspace({
    List<String>? services,
    String mode = 'read_write',
  }) =>
      _runIntegrationCommand('connect_google_workspace', {
        if (services != null) 'services': services,
        'mode': mode,
      });

  Future<bool> disconnectGoogle({bool revoke = false}) =>
      _runIntegrationCommand('disconnect_google', {'revoke': revoke});

  Future<bool> connectMicrosoftOAuth({
    List<String>? services,
    String mode = 'read_write',
  }) =>
      _runIntegrationCommand('connect_microsoft_oauth', {
        if (services != null) 'services': services,
        'mode': mode,
        'openBrowser': true,
      });

  Future<bool> connectMicrosoft365({
    List<String>? services,
    String mode = 'read_write',
  }) =>
      _runIntegrationCommand('connect_microsoft_365', {
        if (services != null) 'services': services,
        'mode': mode,
      });

  Future<bool> disconnectMicrosoft({bool revoke = false}) =>
      _runIntegrationCommand('disconnect_microsoft', {'revoke': revoke});

  Future<bool> connectAzureOAuth({String mode = 'read_write'}) =>
      _runIntegrationCommand('connect_azure_oauth', {
        'mode': mode,
        'openBrowser': true,
      });

  Future<bool> connectAzure({String mode = 'read_write'}) =>
      _runIntegrationCommand('connect_azure', {'mode': mode});

  Future<bool> disconnectAzure({bool revoke = false}) =>
      _runIntegrationCommand('disconnect_azure', {'revoke': revoke});

  Future<bool> connectXeroOAuth({
    String mode = 'read_write',
    bool extended = false,
    bool fullScopes = false,
  }) =>
      _runIntegrationCommand('connect_xero_oauth', {
        'mode': mode,
        'extended': extended,
        'fullScopes': fullScopes,
        'openBrowser': true,
      });

  Future<bool> disconnectXero({bool revoke = false}) =>
      _runIntegrationCommand('disconnect_xero', {'revoke': revoke});

  Future<bool> connectSlackOAuth({String mode = 'read_write'}) =>
      _runIntegrationCommand('connect_slack_oauth', {
        'mode': mode,
        'openBrowser': true,
      });

  Future<bool> disconnectSlack({bool revoke = false}) =>
      _runIntegrationCommand('disconnect_slack', {'revoke': revoke});

  Future<bool> connectLinearOAuth({String mode = 'read_write'}) =>
      _runIntegrationCommand('connect_linear_oauth', {
        'mode': mode,
        'openBrowser': true,
      });

  Future<bool> disconnectLinear({bool revoke = false}) =>
      _runIntegrationCommand('disconnect_linear', {'revoke': revoke});

  Future<bool> connectNotionOAuth({String mode = 'read_write'}) =>
      _runIntegrationCommand('connect_notion_oauth', {
        'mode': mode,
        'openBrowser': true,
      });

  Future<bool> disconnectNotion({bool revoke = false}) =>
      _runIntegrationCommand('disconnect_notion', {'revoke': revoke});

  Future<bool> connectGithubOAuth({String mode = 'read_write'}) =>
      _runIntegrationCommand('connect_github_oauth', {
        'mode': mode,
        'openBrowser': true,
      });

  Future<bool> connectGithub({String mode = 'read_write'}) =>
      _runIntegrationCommand('connect_github', {'mode': mode});

  Future<bool> disconnectGithub({bool revoke = false}) =>
      _runIntegrationCommand('disconnect_github', {'revoke': revoke});

  Future<bool> attachIntegrationMcp({
    required String name,
    required String url,
    bool readOnly = false,
    String authKind = 'none',
    String authEnv = '',
    String authHeader = 'Authorization',
  }) =>
      _runIntegrationCommand('attach_integration_mcp', {
        'name': name,
        'url': url,
        'read_only': readOnly,
        'auth': _integrationAuthPayload(authKind, authEnv, authHeader),
      });

  Future<bool> detachIntegrationMcp(String name) =>
      _runIntegrationCommand('detach_integration_mcp', {'name': name});

  Future<bool> connectIntegrationOpenApi({
    required String name,
    required String specUrl,
    String baseUrl = '',
    String authKind = 'bearer',
    String authEnv = '',
    String authHeader = 'X-Api-Key',
  }) =>
      _runIntegrationCommand('connect_integration_openapi', {
        'name': name,
        'specUrl': specUrl,
        if (baseUrl.isNotEmpty) 'baseUrl': baseUrl,
        'auth': _integrationAuthPayload(authKind, authEnv, authHeader),
      });

  Future<bool> disconnectIntegrationOpenApi(String name) =>
      _runIntegrationCommand('disconnect_integration_openapi', {'name': name});

  String _integrationsStatusLine() {
    final snap = integrations;
    final parts = <String>[];
    void push(String label, bool connected, String who) {
      if (connected) parts.add('$label: $who');
    }
    final g = snap.google.accounts.isNotEmpty ? snap.google.accounts.first : null;
    push('Google', g != null, g?.email ?? g?.accountId ?? '');
    final ms = snap.microsoft.accounts.isNotEmpty ? snap.microsoft.accounts.first : null;
    push('Microsoft', ms != null, ms?.email ?? ms?.accountId ?? '');
    final x = snap.xero.accounts.isNotEmpty ? snap.xero.accounts.first : null;
    push('Xero', x != null, x?.tenantName ?? x?.email ?? x?.accountId ?? '');
    final sl = snap.slack.accounts.isNotEmpty ? snap.slack.accounts.first : null;
    push('Slack', sl != null, sl?.teamName ?? sl?.email ?? '');
    final ln = snap.linear.accounts.isNotEmpty ? snap.linear.accounts.first : null;
    push('Linear', ln != null, ln?.organizationName ?? ln?.email ?? '');
    final no = snap.notion.accounts.isNotEmpty ? snap.notion.accounts.first : null;
    push('Notion', no != null, no?.workspaceName ?? no?.email ?? '');
    final gh = snap.github.accounts.isNotEmpty ? snap.github.accounts.first : null;
    push('GitHub', gh != null, gh?.login ?? gh?.email ?? '');
    if (parts.isEmpty) {
      return 'No integrations connected. Try /connect xero';
    }
    return parts.join(' · ');
  }

  Future<ComposerSlashOutcome> handleComposerSlash(
    ParsedComposerSlash parsed, {
    required int attachmentCount,
  }) async {
    switch (parsed.kind) {
      case SlashCommandKind.help:
        return ComposerSlashOutcome.message(formatSlashHelpText());
      case SlashCommandKind.integrationsStatus:
        if (!_protocol.isConnected) {
          return ComposerSlashOutcome.message('Not connected to sidecar.');
        }
        await loadIntegrations();
        return ComposerSlashOutcome.message(_integrationsStatusLine());
      case SlashCommandKind.abort:
        await abortTurn();
        return ComposerSlashOutcome.abort();
      case SlashCommandKind.receiptWorkflow:
        if (attachmentCount == 0) {
          return ComposerSlashOutcome.message(
            'Attach a receipt image first, then /receipt [note] or Process receipts.',
            clearInput: false,
          );
        }
        final text = parsed.note.trim().isEmpty
            ? 'Process the attached receipt(s) into Xero as draft bill(s).'
            : parsed.note.trim();
        return ComposerSlashOutcome.send(
          text: text,
          workflowPreset: 'receipt_to_xero',
        );
      case SlashCommandKind.attach:
        final path = parsed.args.isNotEmpty ? parsed.args.first.trim() : '';
        if (path.isEmpty) {
          return ComposerSlashOutcome.message('Usage: /attach <image-path>', clearInput: false);
        }
        return ComposerSlashOutcome.attachPath(path);
      case SlashCommandKind.connect:
        final provider = parsed.args.isNotEmpty ? parsed.args.first : '';
        if (provider.isEmpty) {
          return ComposerSlashOutcome.message(
            'Usage: /connect <slack|linear|notion|xero|github|google|microsoft|azure> [--read-only]',
            clearInput: false,
          );
        }
        final mode = parsed.readOnly ? 'read_only' : 'read_write';
        final ok = switch (provider) {
          'slack' => await connectSlackOAuth(mode: mode),
          'linear' => await connectLinearOAuth(mode: mode),
          'notion' => await connectNotionOAuth(mode: mode),
          'xero' => await connectXeroOAuth(mode: mode),
          'github' => await connectGithubOAuth(mode: mode),
          'google' => await connectGoogleOAuth(mode: mode),
          'microsoft' => await connectMicrosoftOAuth(mode: mode),
          'azure' => await connectAzureOAuth(mode: mode),
          _ => false,
        };
        if (!ok && integrationsError != null) {
          return ComposerSlashOutcome.message(integrationsError!, clearInput: false);
        }
        if (!ok) {
          return ComposerSlashOutcome.message('Connect failed for $provider', clearInput: false);
        }
        return ComposerSlashOutcome.message(
          '$provider: complete sign-in in the browser tab',
        );
      case SlashCommandKind.disconnect:
        final provider = parsed.args.isNotEmpty ? parsed.args.first : '';
        if (provider.isEmpty) {
          return ComposerSlashOutcome.message(
            'Usage: /disconnect <provider>',
            clearInput: false,
          );
        }
        final ok = switch (provider) {
          'slack' => await disconnectSlack(),
          'linear' => await disconnectLinear(),
          'notion' => await disconnectNotion(),
          'xero' => await disconnectXero(),
          'github' => await disconnectGithub(),
          'google' => await disconnectGoogle(),
          'microsoft' => await disconnectMicrosoft(),
          'azure' => await disconnectAzure(),
          _ => false,
        };
        if (!ok && integrationsError != null) {
          return ComposerSlashOutcome.message(integrationsError!, clearInput: false);
        }
        return ComposerSlashOutcome.message(
          ok ? '$provider: disconnected' : 'Disconnect failed for $provider',
          clearInput: ok,
        );
    }
  }

  Map<String, dynamic> _integrationAuthPayload(
    String kind,
    String envVar,
    String headerName,
  ) {
    if (kind == 'none' || envVar.trim().isEmpty) {
      return {'kind': 'none'};
    }
    if (kind == 'header') {
      return {
        'kind': 'header',
        'envVar': envVar.trim(),
        'headerName': headerName.trim().isEmpty ? 'Authorization' : headerName.trim(),
      };
    }
    return {'kind': kind, 'envVar': envVar.trim()};
  }

  Future<void> loadOrchestration() async {
    if (!_protocol.isConnected) return;
    final result = await _protocol.send('get_orchestration', {});
    if (result.ok && result.data is Map) {
      orchestration = OrchestrationSnapshot.fromJson(
        Map<String, dynamic>.from(result.data! as Map),
      );
      notifyListeners();
    }
  }

  Future<bool> startOrchestration(String goal, {int maxWorkers = 4}) async {
    if (!_protocol.isConnected || orchestrationBusy) return false;
    orchestrationBusy = true;
    notifyListeners();
    try {
      final result = await _protocol.send('start_orchestration', {
        'goal': goal,
        'maxWorkers': maxWorkers,
        'yolo': true,
      });
      if (result.ok && result.data is Map) {
        orchestration = OrchestrationSnapshot.fromJson(
          Map<String, dynamic>.from(result.data! as Map),
        );
        notifyListeners();
        return true;
      }
      return false;
    } finally {
      orchestrationBusy = false;
      notifyListeners();
    }
  }

  Future<void> stopOrchestration() async {
    if (!_protocol.isConnected) return;
    orchestrationBusy = true;
    notifyListeners();
    try {
      await _protocol.send('stop_orchestration', {
        if (orchestration.id.isNotEmpty) 'orchestrationId': orchestration.id,
      });
    } finally {
      orchestrationBusy = false;
      notifyListeners();
    }
  }

  /// Open worker + synthesis chats in the workspace (up to [maxVisibleChats]).
  Future<void> openOrchestrationWorkspace() async {
    final ids = orchestration.workerChatIds;
    if (ids.isEmpty) return;
    inChatWorkspace = true;
    await _ensureChatOpen(ids.first);
    visibleChatIds = [ids.first];
    if (activeChatId != ids.first) {
      await _protocol.send('activate_chat', {'chatId': ids.first});
      activeChatId = ids.first;
    }
    for (var i = 1; i < ids.length && visibleChatIds.length < maxVisibleChats; i++) {
      await openChatBeside(ids[i]);
    }
    _syncAssetResolver(chatId: activeChatId);
    _syncDictationAudioClient();
    notifyListeners();
  }

  Future<String?> createChat({String? title}) async {
    if (!_protocol.isConnected) return null;
    final result = await _protocol.send(
      'create_chat',
      {if (title != null) 'title': title},
    );
    await refreshConfig();
    if (!result.ok) return null;
    final data = result.data;
    if (data is Map) {
      return data['chatId'] as String?;
    }
    return activeChatId;
  }

  void returnToHub() {
    inChatWorkspace = false;
    visibleChatIds = [];
    if (dictationSessionActive) {
      unawaited(dictation.endSession());
    }
    notifyListeners();
  }

  Future<void> enterChatWorkspace(String chatId) async {
    if (!_protocol.isConnected) return;
    inChatWorkspace = true;
    await _ensureChatOpen(chatId);
    if (activeChatId != chatId) {
      await _protocol.send('activate_chat', {'chatId': chatId});
      activeChatId = chatId;
      await refreshConfig();
    }
    visibleChatIds = [chatId];
    _syncAssetResolver(chatId: chatId);
    _syncDictationAudioClient();
    _syncPersonaPendingFromActiveChat();
    notifyListeners();
  }

  void _ensureVisibleInitialized() {
    if (!inChatWorkspace) return;
    if (visibleChatIds.isEmpty && activeChatId != null) {
      visibleChatIds = [activeChatId!];
    }
  }

  void _pruneVisibleChats() {
    final ids = chats.map((c) => c.chatId).toSet();
    visibleChatIds = visibleChatIds.where(ids.contains).toList();
    if (!inChatWorkspace) return;
    if (visibleChatIds.isEmpty && activeChatId != null && ids.contains(activeChatId)) {
      visibleChatIds = [activeChatId!];
    }
  }

  Future<void> _ensureChatOpen(String chatId, {bool replayIfEmpty = true}) async {
    await _protocol.send('open_chat', {'chatId': chatId});
    if (replayIfEmpty && _sessions.sessionFor(chatId).messages.isEmpty) {
      await _protocol.send('replay_transcript', {'chatId': chatId});
    }
  }

  /// Switch to a single chat (closes split layout).
  Future<void> activateChat(String chatId) async {
    if (!_protocol.isConnected) return;
    inChatWorkspace = true;
    _sessions.sessionFor(chatId).clearTranscript();
    await _protocol.send('activate_chat', {'chatId': chatId});
    activeChatId = chatId;
    visibleChatIds = [chatId];
    _syncAssetResolver(chatId: chatId);
    _syncDictationAudioClient();
    await refreshConfig();
    notifyListeners();
  }

  /// Focus composer + dictation on a chat already visible in a pane.
  Future<void> focusChat(String chatId) async {
    if (activeChatId == chatId) return;
    if (!visibleChatIds.contains(chatId)) {
      await activateChat(chatId);
      return;
    }
    if (dictationSessionActive) {
      await dictation.endSession();
    }
    activeChatId = chatId;
    _syncAssetResolver(chatId: chatId);
    _syncDictationAudioClient();
    await refreshConfig();
    notifyListeners();
  }

  /// Add a second pane without tearing down the first chat's harness.
  Future<void> openChatBeside(String chatId) async {
    if (!_protocol.isConnected) return;
    inChatWorkspace = true;
    if (visibleChatIds.contains(chatId)) {
      await focusChat(chatId);
      return;
    }
    await _ensureChatOpen(chatId);
    final next = List<String>.from(visibleChatIds);
    if (next.length >= maxVisibleChats) {
      next.removeLast();
    }
    if (!next.contains(chatId)) {
      next.add(chatId);
    }
    if (next.isEmpty) {
      next.add(chatId);
    }
    visibleChatIds = next;
    await focusChat(chatId);
  }

  Future<void> closeChatPane(String chatId) async {
    if (visibleChatIds.length <= 1) return;
    visibleChatIds = visibleChatIds.where((id) => id != chatId).toList();
    if (activeChatId == chatId && visibleChatIds.isNotEmpty) {
      await focusChat(visibleChatIds.first);
      return;
    }
    notifyListeners();
  }

  Future<void> deleteChat(String chatId) async {
    if (!_protocol.isConnected) return;
    await _protocol.send('delete_chat', {'chatId': chatId});
    _sessions.remove(chatId);
    visibleChatIds = visibleChatIds.where((id) => id != chatId).toList();
    notifyListeners();
  }

  Future<void> resetSession({bool greet = false, bool rebootstrap = false}) async {
    final chatId = activeChatId;
    if (chatId == null || !_protocol.isConnected) return;
    await _protocol.send('reset_session', {
      'chatId': chatId,
      if (greet) 'greet': true,
      if (rebootstrap) 'rebootstrap': true,
    });
    _sessions.sessionFor(chatId).clearTranscript();
    if (rebootstrap) {
      await refreshConfig();
    }
  }

  void _applyAppList(Map<String, dynamic> data, {bool openAuto = false}) {
    final appsRaw = data['apps'];
    final cachesRaw = data['caches'];
    if (appsRaw is List) {
      desktopApps = appsRaw
          .whereType<Map>()
          .map((m) => LiminalAppSpec.fromJson(Map<String, dynamic>.from(m)))
          .toList();
    }
    if (cachesRaw is Map) {
      desktopAppCaches = {};
      for (final entry in cachesRaw.entries) {
        if (entry.value is Map) {
          desktopAppCaches[entry.key] = AppCacheEntry.fromJson(
            Map<String, dynamic>.from(entry.value as Map),
          );
        }
      }
    }
    _appWindows.syncRegistry(
      apps: desktopApps,
      caches: desktopAppCaches,
      openAutoOnBoot: openAuto,
    );
    desktopAppsLoading = false;
  }

  void _upsertDesktopApp(LiminalAppSpec spec) {
    final next = List<LiminalAppSpec>.from(desktopApps);
    final idx = next.indexWhere((a) => a.id == spec.id);
    if (idx >= 0) {
      next[idx] = spec;
    } else {
      next.add(spec);
    }
    desktopApps = next;
    _appWindows.updateSpec(spec);
    _appWindows.syncRegistry(apps: desktopApps, caches: desktopAppCaches);
  }

  Future<void> loadDesktopApps() async {
    if (!LiminalFeatureFlags.desktopAppsEnabled) return;
    if (!_protocol.isConnected) return;
    desktopAppsLoading = true;
    notifyListeners();
    await _protocol.send('list_apps', {});
  }

  Future<bool> openDesktopAppWindow(String appId) async {
    if (!_protocol.isConnected) return false;
    final result = await _protocol.send('open_app_window', {'appId': appId});
    return result.ok;
  }

  Future<bool> refreshDesktopApp(String appId) async {
    if (!_protocol.isConnected) return false;
    final result = await _protocol.send('refresh_app', {'appId': appId});
    if (result.ok && result.data is Map) {
      final cacheJson = (result.data as Map)['cache'];
      if (cacheJson is Map) {
        final cache = AppCacheEntry.fromJson(Map<String, dynamic>.from(cacheJson));
        desktopAppCaches[appId] = cache;
        _appWindows.updateCache(appId, cache);
        notifyListeners();
      }
    }
    return result.ok;
  }

  Future<bool> removeDesktopApp(String appId) async {
    if (!_protocol.isConnected) return false;
    final result = await _protocol.send('remove_app', {'appId': appId});
    return result.ok;
  }

  Future<bool> updateDesktopApp({
    required String appId,
    String? title,
    Map<String, dynamic>? props,
    bool? autoOpen,
  }) async {
    if (!_protocol.isConnected) return false;
    final result = await _protocol.send('update_app', {
      'appId': appId,
      if (title != null) 'title': title,
      if (props != null) 'props': props,
      if (autoOpen != null) 'auto_open': autoOpen,
    });
    return result.ok;
  }

  @override
  void dispose() {
    _stopIntegrationsPolling();
    unawaited(_appWindows.closeAll());
    speechOutput.removeListener(notifyListeners);
    dictation.removeListener(notifyListeners);
    dictation.dispose();
    speechOutput.dispose();
    _sessions.disposeAll();
    _protocol.disconnect();
    _sidecar.shutdown();
    super.dispose();
  }
}

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../core/connection_phase.dart';
import '../core/protocol_client.dart';
import '../core/session_registry.dart';
import '../core/sidecar_lifecycle.dart';
import '../models/user_image_attachment.dart';
import '../ui/rich_message/asset_url_resolver.dart';
import '../models/app_config.dart';
import '../models/harness_settings.dart';
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
  AppController({this.repoRoot}) : _sidecar = SidecarLifecycle(repoRoot: repoRoot) {
    _protocol.onGlobalFrame = _onGlobalFrame;
    _protocol.onChatFrame = (chatId, event, data) {
      _sessions.dispatch(chatId, event, data);
    };
  }

  final String? repoRoot;

  final SidecarLifecycle _sidecar;
  final ProtocolClient _protocol = ProtocolClient();
  final SessionRegistry _sessions = SessionRegistry();
  int? _sidecarPort;
  String? _sidecarToken;

  ConnectionPhase phase = ConnectionPhase.idle;
  String? bootError;
  AppConfig? config;
  bool configLoading = false;
  bool sidecarReady = false;
  String? setupError;
  bool setupSaving = false;
  HarnessSettingsSnapshot? harnessSettings;
  bool harnessSettingsLoading = false;
  VireonAccountSnapshot vireonAccount = VireonAccountSnapshot.empty;
  bool vireonAccountLoading = false;
  bool vireonAuthBusy = false;
  String? vireonAuthError;

  /// Harness internals in the transcript (trace, working state, retries). Tool
  /// activity rows always show; this only toggles verbose tool args/output.
  bool showRawHarness = false;

  void setShowRawHarness(bool value) {
    if (showRawHarness == value) return;
    showRawHarness = value;
    notifyListeners();
  }

  void toggleShowRawHarness() => setShowRawHarness(!showRawHarness);

  int get protocolVersion => _protocol.protocolVersion;
  String get sidecarVersion => _protocol.sidecarVersion;

  String? activeChatId;
  List<ChatSummary> chats = [];

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
    notifyListeners();

    try {
      final proc = await _sidecar.ensureRunning(
        attachToExisting: SidecarLifecycle.attachFromEnv,
      );
      _sidecarPort = proc.port;
      _sidecarToken = proc.token;
      await _protocol.connect(port: proc.port, token: proc.token);
      _syncAssetResolver();
      await _protocol.waitForHello();

      phase = ConnectionPhase.connected;
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
      return true;
    } catch (e) {
      vireonAuthError = e.toString();
      return false;
    } finally {
      vireonAuthBusy = false;
      notifyListeners();
    }
  }

  Future<void> loadHarnessSettings() async {
    if (!_protocol.isConnected) return;
    harnessSettingsLoading = true;
    notifyListeners();
    try {
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
        sidecarReady = true;
        notifyListeners();
        return;
      case 'chat_list':
        activeChatId = frame.data['activeChatId'] as String?;
        chats = _parseChats(frame.data['chats']);
        _syncAssetResolver();
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
      default:
        return;
    }
  }

  void _applyHelloPayload(Map<String, dynamic> data) {
    activeChatId = data['activeChatId'] as String?;
    chats = _parseChats(data['chats']);
    _syncAssetResolver();
    final appConfig = data['appConfig'];
    if (appConfig is Map) {
      _applyConfigFromJson(Map<String, dynamic>.from(appConfig));
    }
    sidecarReady = true;
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
          config = AppConfig(
            apiKeyConfigured: config!.apiKeyConfigured,
            personaBootstrapEnabled: config!.personaBootstrapEnabled,
            personaBootstrapPending: active.awaitingPersonaBootstrap,
            personaBootstrapAllowSkip: config!.personaBootstrapAllowSkip,
            personaDisplayLabel: config!.personaDisplayLabel,
            providerModel: config!.providerModel,
            providerBaseUrl: config!.providerBaseUrl,
            modelLockedByEnv: config!.modelLockedByEnv,
            baseUrlLockedByEnv: config!.baseUrlLockedByEnv,
            repoRoot: config!.repoRoot,
            personaUiTheme: config!.personaUiTheme,
          );
  }

  List<ChatSummary> _parseChats(dynamic raw) {
    return (raw as List<dynamic>? ?? [])
        .map((e) => ChatSummary.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  Future<void> sendMessage(
    String text, {
    bool freshContext = false,
    List<UserImageAttachment> attachments = const [],
  }) async {
    final chatId = activeChatId;
    final trimmed = text.trim();
    if (chatId == null || !_protocol.isConnected) return;
    if (trimmed.isEmpty && attachments.isEmpty) return;
    if (needsProviderSetup || needsPersonaBootstrap) return;

    _syncAssetResolver(chatId: chatId);

    final previews = [
      for (final a in attachments) UserAttachmentPreview(name: a.name),
    ];
    _sessions.sessionFor(chatId).applyUserMessage(
      trimmed,
      attachmentPreviews: previews,
    );
    final result = await _protocol.send('send_message', {
      'chatId': chatId,
      'message': trimmed,
      if (freshContext) 'freshContext': true,
      if (attachments.isNotEmpty)
        'attachments': attachments.map((a) => a.toWire()).toList(),
    });
    if (!result.ok) {
      _sessions.sessionFor(chatId).setConnectionError(
        result.error ?? 'send_message failed',
      );
    }
  }

  Future<void> abortTurn() async {
    final chatId = activeChatId;
    if (chatId == null || !_protocol.isConnected) return;
    await _protocol.send('abort', {'chatId': chatId});
  }

  Future<void> resolveApproval(String decision, {String? reason}) async {
    final chatId = activeChatId;
    final session = activeSession;
    final pending = session?.pendingApproval;
    if (chatId == null || !_protocol.isConnected || pending == null) return;

    final approvalPayload = decision == 'approve'
        ? {'decision': 'approve'}
        : {
            'decision': 'reject',
            'reason': reason?.trim().isNotEmpty == true
                ? reason!.trim()
                : 'user declined',
          };
    await _protocol.send('resolve_approval', {
      'chatId': chatId,
      'callId': pending.callId,
      'approvalNonce': pending.approvalNonce,
      'decision': approvalPayload,
    });
    session!.applyServerEvent('approval_decision', {});
  }

  Future<void> resolveAskUser(String answer) async {
    final chatId = activeChatId;
    if (chatId == null || !_protocol.isConnected) return;
    await _protocol.send('resolve_ask_user', {
      'chatId': chatId,
      'answer': answer,
    });
    activeSession?.applyServerEvent('ask_user_answered', {});
  }

  Future<void> createChat({String? title}) async {
    if (!_protocol.isConnected) return;
    await _protocol.send('create_chat', {if (title != null) 'title': title});
    await refreshConfig();
  }

  Future<void> activateChat(String chatId) async {
    if (!_protocol.isConnected) return;
    await _protocol.send('activate_chat', {'chatId': chatId});
    await refreshConfig();
  }

  Future<void> deleteChat(String chatId) async {
    if (!_protocol.isConnected) return;
    await _protocol.send('delete_chat', {'chatId': chatId});
    _sessions.remove(chatId);
    notifyListeners();
  }

  Future<void> resetSession({bool greet = false}) async {
    final chatId = activeChatId;
    if (chatId == null || !_protocol.isConnected) return;
    await _protocol.send('reset_session', {
      'chatId': chatId,
      if (greet) 'greet': true,
    });
    _sessions.sessionFor(chatId).clearTranscript();
  }

  @override
  void dispose() {
    _sessions.disposeAll();
    _protocol.disconnect();
    _sidecar.shutdown();
    super.dispose();
  }
}

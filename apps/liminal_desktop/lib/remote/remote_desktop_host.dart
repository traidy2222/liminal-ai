import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:image/image.dart' as img;
import 'package:liminal_remote_desktop/liminal_remote_desktop.dart';

import '../core/protocol_client.dart';

/// Captures the native Liminal window and publishes JPEG frames to the sidecar.
class RemoteDesktopHost {
  RemoteDesktopHost(this._protocol);

  final ProtocolClient _protocol;
  Timer? _timer;
  Timer? _inputPollTimer;
  bool _active = false;
  bool _cloud = false;
  String? _cloudJoinCode;
  int _seq = 0;
  String? _lastWindowId;
  String? _mainWindowId;

  static const _lanInterval = Duration(milliseconds: 83); // ~12 fps
  static const _cloudInterval = Duration(milliseconds: 167); // ~6 fps

  Future<void> ensureMainWindowRegistered() async {
    _mainWindowId ??= 'main';
    await LiminalRemoteDesktop.registerWindow(windowId: _mainWindowId!, isMain: true);
  }

  Future<void> registerSubWindow(String windowId) async {
    await LiminalRemoteDesktop.registerWindow(windowId: windowId);
  }

  Future<void> unregisterSubWindow(String windowId) async {
    await LiminalRemoteDesktop.unregisterWindow(windowId);
  }

  void onRemoteSession(Map<String, dynamic> status) {
    final active = status['active'] as bool? ?? false;
    final grants = status['grants'];
    var cloud = false;
    if (grants is List && grants.isNotEmpty) {
      final first = grants.first;
      if (first is Map) {
        cloud = first['cloud'] as bool? ?? false;
        _cloudJoinCode = first['joinCode'] as String?;
      }
    }
    if (active) {
      unawaited(_start(cloud: cloud));
    } else {
      _stop();
    }
  }

  void onRemoteUiInput(Map<String, dynamic> data) {
    final event = RemoteDesktopInputEvent.fromJson(data);
    unawaited(LiminalRemoteDesktop.injectInput(event));
  }

  Future<void> _start({required bool cloud}) async {
    if (_active && _cloud == cloud) return;
    _stop();
    _active = true;
    _cloud = cloud;
    await ensureMainWindowRegistered();
    final interval = cloud ? _cloudInterval : _lanInterval;
    _timer = Timer.periodic(interval, (_) => unawaited(_tick()));
    if (cloud) {
      _inputPollTimer = Timer.periodic(const Duration(milliseconds: 200), (_) {
        unawaited(_pollCloudInput());
      });
    }
    unawaited(_tick());
  }

  void _stop() {
    _active = false;
    _cloud = false;
    _cloudJoinCode = null;
    _timer?.cancel();
    _timer = null;
    _inputPollTimer?.cancel();
    _inputPollTimer = null;
    _seq = 0;
    _lastWindowId = null;
  }

  Future<void> _tick() async {
    if (!_active) return;
    try {
      final windows = await LiminalRemoteDesktop.listWindows();
      final focused = windows.where((w) => w.focused).toList();
      if (focused.isNotEmpty) {
        await LiminalRemoteDesktop.setCaptureTarget(focused.first.windowId);
      } else if (_mainWindowId != null) {
        await LiminalRemoteDesktop.setCaptureTarget(_mainWindowId);
      }

      final frame = await LiminalRemoteDesktop.captureFrame();
      if (frame == null) return;

      Uint8List? jpegBytes;
      if (frame.jpeg.length >= 2 && frame.jpeg[0] == 0xff && frame.jpeg[1] == 0xd8) {
        jpegBytes = Uint8List.fromList(frame.jpeg);
      } else if (frame.pixels.isNotEmpty) {
        jpegBytes = _encodePixelsToJpeg(
          frame.pixels,
          frame.width,
          frame.height,
          frame.pixelFormat,
        );
      }
      if (jpegBytes == null || jpegBytes.isEmpty) return;

      if (frame.windowId.isNotEmpty && frame.windowId != _lastWindowId) {
        _lastWindowId = frame.windowId;
      }

      _seq += 1;
      await _protocol.send('remote_ui_frame', {
        'jpegBase64': base64Encode(jpegBytes),
        'width': frame.width,
        'height': frame.height,
        'windowId': frame.windowId,
        'title': frame.title,
        'seq': _seq,
      });
    } catch (_) {
      /* capture is best-effort */
    }
  }

  Uint8List? _encodePixelsToJpeg(
    List<int> pixels,
    int width,
    int height,
    String? format,
  ) {
    if (width <= 0 || height <= 0) return null;
    final expected = width * height * 4;
    if (pixels.length < expected) return null;
    final order = format == 'bgra' ? img.ChannelOrder.bgra : img.ChannelOrder.rgba;
    final image = img.Image.fromBytes(
      width: width,
      height: height,
      bytes: Uint8List.fromList(pixels).buffer,
      numChannels: 4,
      order: order,
    );
    return Uint8List.fromList(img.encodeJpg(image, quality: _cloud ? 55 : 72));
  }

  Future<void> _pollCloudInput() async {
    if (!_cloud || _cloudJoinCode == null) return;
    try {
      await _protocol.send('remote_ui_poll_input', {'joinCode': _cloudJoinCode});
    } catch (_) {
      /* best-effort */
    }
  }

  void dispose() => _stop();
}

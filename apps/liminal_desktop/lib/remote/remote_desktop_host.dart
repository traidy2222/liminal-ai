import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
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
  bool _tickInFlight = false;
  bool _pollInFlight = false;
  int _focusPass = 0;
  int _pendingFrames = 0;

  static const _lanInterval = Duration(milliseconds: 100); // ~10 fps max
  static const _cloudInterval = Duration(milliseconds: 350); // ~3 fps — keeps UI responsive
  static const _cloudInputPollInterval = Duration(milliseconds: 120);
  static const _cloudMaxWidth = 1280;
  static const _maxPendingFrames = 1;

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

  /// Called after [remote_enable] ack so cloud input poll has the join code immediately.
  void noteCloudJoinCode(String? joinCode) {
    final code = joinCode?.trim();
    if (code != null && code.isNotEmpty) {
      _cloudJoinCode = code;
    }
  }

  void onRemoteSession(Map<String, dynamic> status) {
    final active = status['active'] as bool? ?? false;
    final grants = status['grants'];
    var cloud = false;
    if (grants is List && grants.isNotEmpty) {
      final first = grants.first;
      if (first is Map) {
        cloud = first['cloud'] as bool? ?? false;
        noteCloudJoinCode(first['joinCode'] as String?);
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
      _inputPollTimer = Timer.periodic(_cloudInputPollInterval, (_) {
        unawaited(_pollCloudInput());
      });
    }
    unawaited(_tick());
    if (cloud) unawaited(_pollCloudInput());
  }

  void _stop() {
    _active = false;
    _cloud = false;
    _cloudJoinCode = null;
    _timer?.cancel();
    _timer = null;
    _inputPollTimer?.cancel();
    _inputPollTimer = null;
    _tickInFlight = false;
    _pollInFlight = false;
    _focusPass = 0;
    _pendingFrames = 0;
    _seq = 0;
    _lastWindowId = null;
  }

  Future<void> _tick() async {
    if (!_active || _tickInFlight) return;
    if (_pendingFrames >= _maxPendingFrames) return;

    _tickInFlight = true;
    try {
      if (++_focusPass >= 6) {
        _focusPass = 0;
        await _syncCaptureTarget();
      }

      final frame = await LiminalRemoteDesktop.captureFrame();
      if (frame == null || !_active) return;

      final encoded = await _frameToJpeg(frame);
      if (encoded == null || !_active) return;

      if (frame.windowId.isNotEmpty && frame.windowId != _lastWindowId) {
        _lastWindowId = frame.windowId;
      }

      _seq += 1;
      _pendingFrames += 1;
      unawaited(
        _protocol
            .send(
              'remote_ui_frame',
              {
                'jpegBase64': base64Encode(encoded.bytes),
                'width': encoded.width,
                'height': encoded.height,
                'windowId': frame.windowId,
                'title': frame.title,
                'seq': _seq,
              },
              timeout: const Duration(seconds: 15),
            )
            .whenComplete(() {
          if (_pendingFrames > 0) _pendingFrames -= 1;
        }),
      );
    } catch (_) {
      /* capture is best-effort */
    } finally {
      _tickInFlight = false;
    }
  }

  Future<void> _syncCaptureTarget() async {
    final windows = await LiminalRemoteDesktop.listWindows();
    final focused = windows.where((w) => w.focused).toList();
    if (focused.isNotEmpty) {
      await LiminalRemoteDesktop.setCaptureTarget(focused.first.windowId);
    } else if (_mainWindowId != null) {
      await LiminalRemoteDesktop.setCaptureTarget(_mainWindowId);
    }
  }

  Future<_EncodedJpeg?> _frameToJpeg(RemoteDesktopFrame frame) async {
    if (frame.jpeg.length >= 2 && frame.jpeg[0] == 0xff && frame.jpeg[1] == 0xd8) {
      final bytes = Uint8List.fromList(frame.jpeg);
      if (!_cloud || frame.width <= _cloudMaxWidth) {
        return _EncodedJpeg(bytes: bytes, width: frame.width, height: frame.height);
      }
      return compute(
        _recompressJpeg,
        _JpegEncodeRequest(
          pixels: bytes,
          width: frame.width,
          height: frame.height,
          format: 'jpeg',
          quality: 55,
          maxWidth: _cloudMaxWidth,
        ),
      );
    }
    if (frame.pixels.isEmpty) return null;
    return compute(
      _encodePixelsToJpeg,
      _JpegEncodeRequest(
        pixels: Uint8List.fromList(frame.pixels),
        width: frame.width,
        height: frame.height,
        format: frame.pixelFormat,
        quality: _cloud ? 55 : 72,
        maxWidth: _cloud ? _cloudMaxWidth : 0,
      ),
    );
  }

  Future<void> _pollCloudInput() async {
    if (!_cloud || _cloudJoinCode == null || _pollInFlight) return;
    _pollInFlight = true;
    try {
      await _protocol.send(
        'remote_ui_poll_input',
        {'joinCode': _cloudJoinCode},
        timeout: const Duration(seconds: 8),
      );
    } catch (_) {
      /* best-effort */
    } finally {
      _pollInFlight = false;
    }
  }

  void dispose() => _stop();
}

class _EncodedJpeg {
  const _EncodedJpeg({required this.bytes, required this.width, required this.height});

  final Uint8List bytes;
  final int width;
  final int height;
}

class _JpegEncodeRequest {
  const _JpegEncodeRequest({
    required this.pixels,
    required this.width,
    required this.height,
    this.format,
    required this.quality,
    required this.maxWidth,
  });

  final Uint8List pixels;
  final int width;
  final int height;
  final String? format;
  final int quality;
  final int maxWidth;
}

_EncodedJpeg? _encodePixelsToJpeg(_JpegEncodeRequest req) {
  if (req.width <= 0 || req.height <= 0) return null;
  final expected = req.width * req.height * 4;
  if (req.pixels.length < expected) return null;
  final order = req.format == 'bgra' ? img.ChannelOrder.bgra : img.ChannelOrder.rgba;
  var image = img.Image.fromBytes(
    width: req.width,
    height: req.height,
    bytes: req.pixels.buffer,
    numChannels: 4,
    order: order,
  );
  if (req.maxWidth > 0 && image.width > req.maxWidth) {
    image = img.copyResize(image, width: req.maxWidth);
  }
  return _EncodedJpeg(
    bytes: Uint8List.fromList(img.encodeJpg(image, quality: req.quality)),
    width: image.width,
    height: image.height,
  );
}

_EncodedJpeg? _recompressJpeg(_JpegEncodeRequest req) {
  final decoded = img.decodeImage(req.pixels);
  if (decoded == null) {
    return _EncodedJpeg(bytes: req.pixels, width: req.width, height: req.height);
  }
  var image = decoded;
  if (req.maxWidth > 0 && image.width > req.maxWidth) {
    image = img.copyResize(image, width: req.maxWidth);
  }
  return _EncodedJpeg(
    bytes: Uint8List.fromList(img.encodeJpg(image, quality: req.quality)),
    width: image.width,
    height: image.height,
  );
}

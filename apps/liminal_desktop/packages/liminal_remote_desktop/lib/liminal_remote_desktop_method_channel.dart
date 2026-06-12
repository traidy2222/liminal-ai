import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'liminal_remote_desktop_platform_interface.dart';
import 'remote_desktop_types.dart';

class MethodChannelLiminalRemoteDesktop extends LiminalRemoteDesktopPlatform {
  @visibleForTesting
  static const methodChannel = MethodChannel('liminal/remote_desktop');

  @override
  Future<void> registerWindow({required String windowId, bool isMain = false}) async {
    await methodChannel.invokeMethod<void>('registerWindow', {
      'windowId': windowId,
      'isMain': isMain,
    });
  }

  @override
  Future<void> unregisterWindow(String windowId) async {
    await methodChannel.invokeMethod<void>('unregisterWindow', {'windowId': windowId});
  }

  @override
  Future<List<RemoteDesktopWindowInfo>> listWindows() async {
    final raw = await methodChannel.invokeMethod<List<dynamic>>('listWindows');
    if (raw == null) return const [];
    return raw
        .whereType<Map>()
        .map((e) => RemoteDesktopWindowInfo.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  @override
  Future<void> setCaptureTarget(String? windowId) async {
    await methodChannel.invokeMethod<void>('setCaptureTarget', {'windowId': windowId});
  }

  @override
  Future<RemoteDesktopFrame?> captureFrame() async {
    final raw = await methodChannel.invokeMethod<Map<dynamic, dynamic>>('captureFrame');
    if (raw == null) return null;
    return RemoteDesktopFrame.fromJson(Map<String, dynamic>.from(raw));
  }

  @override
  Future<void> injectInput(RemoteDesktopInputEvent event) async {
    await methodChannel.invokeMethod<void>('injectInput', event.toJson());
  }
}

export 'liminal_remote_desktop_platform_interface.dart';
export 'remote_desktop_types.dart';

import 'liminal_remote_desktop_platform_interface.dart';
import 'remote_desktop_types.dart';

class LiminalRemoteDesktop {
  static Future<void> registerWindow({required String windowId, bool isMain = false}) =>
      LiminalRemoteDesktopPlatform.instance.registerWindow(windowId: windowId, isMain: isMain);

  static Future<void> unregisterWindow(String windowId) =>
      LiminalRemoteDesktopPlatform.instance.unregisterWindow(windowId);

  static Future<List<RemoteDesktopWindowInfo>> listWindows() =>
      LiminalRemoteDesktopPlatform.instance.listWindows();

  static Future<void> setCaptureTarget(String? windowId) =>
      LiminalRemoteDesktopPlatform.instance.setCaptureTarget(windowId);

  static Future<RemoteDesktopFrame?> captureFrame() =>
      LiminalRemoteDesktopPlatform.instance.captureFrame();

  static Future<void> injectInput(RemoteDesktopInputEvent event) =>
      LiminalRemoteDesktopPlatform.instance.injectInput(event);
}

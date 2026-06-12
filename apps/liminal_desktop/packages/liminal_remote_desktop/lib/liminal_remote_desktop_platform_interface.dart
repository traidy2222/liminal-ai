import 'package:plugin_platform_interface/plugin_platform_interface.dart';

import 'liminal_remote_desktop_method_channel.dart';
import 'remote_desktop_types.dart';

abstract class LiminalRemoteDesktopPlatform extends PlatformInterface {
  LiminalRemoteDesktopPlatform() : super(token: _token);

  static final Object _token = Object();
  static LiminalRemoteDesktopPlatform _instance = MethodChannelLiminalRemoteDesktop();

  static LiminalRemoteDesktopPlatform get instance => _instance;

  static set instance(LiminalRemoteDesktopPlatform instance) {
    PlatformInterface.verifyToken(instance, _token);
    _instance = instance;
  }

  Future<void> registerWindow({required String windowId, bool isMain = false});
  Future<void> unregisterWindow(String windowId);
  Future<List<RemoteDesktopWindowInfo>> listWindows();
  Future<void> setCaptureTarget(String? windowId);
  Future<RemoteDesktopFrame?> captureFrame();
  Future<void> injectInput(RemoteDesktopInputEvent event);
}

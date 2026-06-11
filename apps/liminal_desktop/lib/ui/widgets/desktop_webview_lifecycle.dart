import 'dart:io';

import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_win_floating/webview_plugin.dart';

/// Eagerly tear down a native WebView2 instance (Windows/Linux).
///
/// `webview_win_floating` only disposes via a [Finalizer] by default; creating
/// a replacement controller before the old one is collected has been linked to
/// native crashes (BEX64 / 0xc0000409) when several embeds overlap (terminal +
/// compose preview + chat HTML fences).
Future<void> disposeDesktopWebView(WebViewController? controller) async {
  if (controller == null) return;
  if (!Platform.isWindows && !Platform.isLinux) return;
  try {
    final platform = controller.platform;
    if (platform is WindowsPlatformWebViewController) {
      await platform.controller.setVisibility(false);
      await platform.controller.dispose();
    }
  } catch (_) {
    /* best-effort — widget may already be gone */
  }
}

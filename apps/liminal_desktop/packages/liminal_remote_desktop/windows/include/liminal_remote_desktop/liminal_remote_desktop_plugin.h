#ifndef LIMINAL_REMOTE_DESKTOP_PLUGIN_H_
#define LIMINAL_REMOTE_DESKTOP_PLUGIN_H_

#include <flutter_plugin_registrar.h>

#ifdef FLUTTER_PLUGIN_IMPL
#define FLUTTER_PLUGIN_EXPORT __declspec(dllexport)
#else
#define FLUTTER_PLUGIN_EXPORT __declspec(dllimport)
#endif

#if defined(__cplusplus)
extern "C" {
#endif

FLUTTER_PLUGIN_EXPORT void LiminalRemoteDesktopPluginRegisterWithRegistrar(
    FlutterDesktopPluginRegistrarRef registrar);

/// Main shell HWND (set once from the runner).
FLUTTER_PLUGIN_EXPORT void LiminalRemoteDesktopSetMainWindowHandle(void* hwnd);

#if defined(__cplusplus)
}  // extern "C"
#endif

#endif  // LIMINAL_REMOTE_DESKTOP_PLUGIN_H_

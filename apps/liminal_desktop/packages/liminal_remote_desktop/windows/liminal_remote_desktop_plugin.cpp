#include "liminal_remote_desktop/liminal_remote_desktop_plugin.h"

#include <windows.h>

#include <flutter/method_channel.h>
#include <flutter/plugin_registrar_windows.h>
#include <flutter/standard_method_codec.h>

#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace {

struct WindowEntry {
  HWND hwnd = nullptr;
  std::wstring title;
  bool is_main = false;
};

std::mutex g_mutex;
std::map<std::string, WindowEntry> g_windows;
std::string g_capture_target;
HWND g_main_hwnd = nullptr;

std::wstring Utf8ToWide(const std::string& s) {
  if (s.empty()) return L"";
  int len = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
  std::wstring out(len - 1, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, out.data(), len);
  return out;
}

std::string WideToUtf8(const std::wstring& s) {
  if (s.empty()) return "";
  int len = WideCharToMultiByte(CP_UTF8, 0, s.c_str(), -1, nullptr, 0, nullptr, nullptr);
  std::string out(len - 1, '\0');
  WideCharToMultiByte(CP_UTF8, 0, s.c_str(), -1, out.data(), len, nullptr, nullptr);
  return out;
}

HWND ResolveCaptureHwnd() {
  std::lock_guard<std::mutex> lock(g_mutex);
  if (!g_capture_target.empty()) {
    auto it = g_windows.find(g_capture_target);
    if (it != g_windows.end() && IsWindow(it->second.hwnd)) {
      return it->second.hwnd;
    }
  }
  HWND fg = GetForegroundWindow();
  for (const auto& kv : g_windows) {
    if (kv.second.hwnd == fg && IsWindow(fg)) return fg;
  }
  for (const auto& kv : g_windows) {
    if (kv.second.is_main && IsWindow(kv.second.hwnd)) return kv.second.hwnd;
  }
  for (const auto& kv : g_windows) {
    if (IsWindow(kv.second.hwnd)) return kv.second.hwnd;
  }
  return g_main_hwnd;
}

bool CaptureHwndToRgba(HWND hwnd, std::vector<uint8_t>& rgba, int& width, int& height) {
  if (!hwnd || !IsWindow(hwnd)) return false;
  RECT rc{};
  if (!GetClientRect(hwnd, &rc)) return false;
  width = rc.right - rc.left;
  height = rc.bottom - rc.top;
  if (width <= 0 || height <= 0) return false;

  HDC hdc_window = GetDC(hwnd);
  if (!hdc_window) return false;
  HDC hdc_mem = CreateCompatibleDC(hdc_window);
  HBITMAP hbm = CreateCompatibleBitmap(hdc_window, width, height);
  HGDIOBJ old = SelectObject(hdc_mem, hbm);
  BOOL printed = PrintWindow(hwnd, hdc_mem, PW_RENDERFULLCONTENT);
  if (!printed) {
    BitBlt(hdc_mem, 0, 0, width, height, hdc_window, 0, 0, SRCCOPY);
  }

  BITMAPINFOHEADER bi{};
  bi.biSize = sizeof(BITMAPINFOHEADER);
  bi.biWidth = width;
  bi.biHeight = -height;
  bi.biPlanes = 1;
  bi.biBitCount = 32;
  bi.biCompression = BI_RGB;
  rgba.resize(static_cast<size_t>(width) * height * 4);
  if (!GetDIBits(hdc_mem, hbm, 0, height, rgba.data(),
                 reinterpret_cast<BITMAPINFO*>(&bi), DIB_RGB_COLORS)) {
    SelectObject(hdc_mem, old);
    DeleteObject(hbm);
    DeleteDC(hdc_mem);
    ReleaseDC(hwnd, hdc_window);
    return false;
  }

  SelectObject(hdc_mem, old);
  DeleteObject(hbm);
  DeleteDC(hdc_mem);
  ReleaseDC(hwnd, hdc_window);
  return true;
}

void InjectClick(HWND hwnd, int x, int y, const std::string& button) {
  POINT pt{x, y};
  ClientToScreen(hwnd, &pt);
  SetCursorPos(pt.x, pt.y);
  INPUT inputs[2]{};
  inputs[0].type = INPUT_MOUSE;
  inputs[0].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
  inputs[0].mi.dx = static_cast<LONG>((pt.x * 65535) / GetSystemMetrics(SM_CXSCREEN));
  inputs[0].mi.dy = static_cast<LONG>((pt.y * 65535) / GetSystemMetrics(SM_CYSCREEN));
  DWORD down = MOUSEEVENTF_LEFTDOWN;
  DWORD up = MOUSEEVENTF_LEFTUP;
  if (button == "right") {
    down = MOUSEEVENTF_RIGHTDOWN;
    up = MOUSEEVENTF_RIGHTUP;
  } else if (button == "middle") {
    down = MOUSEEVENTF_MIDDLEDOWN;
    up = MOUSEEVENTF_MIDDLEUP;
  }
  SetForegroundWindow(hwnd);
  INPUT click[2]{};
  click[0].type = INPUT_MOUSE;
  click[0].mi.dwFlags = down;
  click[1].type = INPUT_MOUSE;
  click[1].mi.dwFlags = up;
  SendInput(2, click, sizeof(INPUT));
}

void InjectWheel(HWND hwnd, int x, int y, double deltaY) {
  POINT pt{x, y};
  ClientToScreen(hwnd, &pt);
  SetCursorPos(pt.x, pt.y);
  SetForegroundWindow(hwnd);
  INPUT input{};
  input.type = INPUT_MOUSE;
  input.mi.dwFlags = MOUSEEVENTF_WHEEL;
  // Browser wheel deltas are pixel-ish; Windows expects multiples of 120 (WHEEL_DELTA).
  const LONG wheel = static_cast<LONG>(-deltaY * 120.0 / 100.0);
  input.mi.mouseData = static_cast<DWORD>(wheel);
  SendInput(1, &input, sizeof(INPUT));
}

void InjectKey(HWND hwnd, const std::string& key) {
  SetForegroundWindow(hwnd);
  if (key.length() == 1) {
    SHORT vk = VkKeyScanA(key[0]);
    BYTE vk_code = LOBYTE(vk);
    INPUT down{};
    down.type = INPUT_KEYBOARD;
    down.ki.wVk = vk_code;
    INPUT up = down;
    up.ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(1, &down, sizeof(INPUT));
    SendInput(1, &up, sizeof(INPUT));
    return;
  }
  if (key == "Enter") {
    INPUT down{};
    down.type = INPUT_KEYBOARD;
    down.ki.wVk = VK_RETURN;
    INPUT up = down;
    up.ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(1, &down, sizeof(INPUT));
    SendInput(1, &up, sizeof(INPUT));
  } else if (key == "Backspace") {
    INPUT down{};
    down.type = INPUT_KEYBOARD;
    down.ki.wVk = VK_BACK;
    INPUT up = down;
    up.ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(1, &down, sizeof(INPUT));
    SendInput(1, &up, sizeof(INPUT));
  } else if (key == "Tab") {
    INPUT down{};
    down.type = INPUT_KEYBOARD;
    down.ki.wVk = VK_TAB;
    INPUT up = down;
    up.ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(1, &down, sizeof(INPUT));
    SendInput(1, &up, sizeof(INPUT));
  }
}

void InjectType(HWND hwnd, const std::string& text) {
  SetForegroundWindow(hwnd);
  for (char c : text) {
    InjectKey(hwnd, std::string(1, c));
  }
}

class LiminalRemoteDesktopPlugin : public flutter::Plugin {
 public:
  static void RegisterWithRegistrar(flutter::PluginRegistrarWindows* registrar) {
    auto channel = std::make_shared<flutter::MethodChannel<flutter::EncodableValue>>(
        registrar->messenger(), "liminal/remote_desktop",
        &flutter::StandardMethodCodec::GetInstance());
    auto plugin = std::make_unique<LiminalRemoteDesktopPlugin>(channel, registrar);
    channel->SetMethodCallHandler(
        [plugin_pointer = plugin.get()](const auto& call, auto result) {
          plugin_pointer->HandleMethodCall(call, std::move(result));
        });
    registrar->AddPlugin(std::move(plugin));
  }

  explicit LiminalRemoteDesktopPlugin(
      std::shared_ptr<flutter::MethodChannel<flutter::EncodableValue>> channel,
      flutter::PluginRegistrarWindows* registrar)
      : channel_(std::move(channel)), registrar_(registrar) {}

 private:
  std::shared_ptr<flutter::MethodChannel<flutter::EncodableValue>> channel_;
  flutter::PluginRegistrarWindows* registrar_;

  HWND NativeWindowHandle() const {
    if (!registrar_ || !registrar_->GetView()) return nullptr;
    return registrar_->GetView()->GetNativeWindow();
  }

 public:

  void HandleMethodCall(
      const flutter::MethodCall<flutter::EncodableValue>& method_call,
      std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> result) {
    const auto& name = method_call.method_name();
    const auto* args = std::get_if<flutter::EncodableMap>(method_call.arguments());

    if (name == "registerWindow") {
      std::string id;
      bool is_main = false;
      if (args) {
        auto id_it = args->find(flutter::EncodableValue("windowId"));
        if (id_it != args->end()) id = std::get<std::string>(id_it->second);
        auto main_it = args->find(flutter::EncodableValue("isMain"));
        if (main_it != args->end()) is_main = std::get<bool>(main_it->second);
      }
      HWND hwnd = NativeWindowHandle();
      if (!hwnd) hwnd = g_main_hwnd;
      if (hwnd) {
        std::lock_guard<std::mutex> lock(g_mutex);
        wchar_t title[512]{};
        GetWindowTextW(hwnd, title, 512);
        g_windows[id] = WindowEntry{hwnd, title, is_main};
        if (is_main) g_main_hwnd = hwnd;
      }
      result->Success();
      return;
    }

    if (name == "unregisterWindow") {
      std::string id;
      if (args) {
        auto id_it = args->find(flutter::EncodableValue("windowId"));
        if (id_it != args->end()) id = std::get<std::string>(id_it->second);
      }
      std::lock_guard<std::mutex> lock(g_mutex);
      g_windows.erase(id);
      result->Success();
      return;
    }

    if (name == "setCaptureTarget") {
      std::string id;
      if (args) {
        auto id_it = args->find(flutter::EncodableValue("windowId"));
        if (id_it != args->end()) {
          const auto& v = id_it->second;
          if (std::holds_alternative<std::string>(v)) id = std::get<std::string>(v);
        }
      }
      std::lock_guard<std::mutex> lock(g_mutex);
      g_capture_target = id;
      result->Success();
      return;
    }

    if (name == "listWindows") {
      HWND fg = GetForegroundWindow();
      flutter::EncodableList list;
      std::lock_guard<std::mutex> lock(g_mutex);
      for (const auto& kv : g_windows) {
        if (!IsWindow(kv.second.hwnd)) continue;
        RECT rc{};
        GetClientRect(kv.second.hwnd, &rc);
        wchar_t title[512]{};
        GetWindowTextW(kv.second.hwnd, title, 512);
        flutter::EncodableMap m;
        m[flutter::EncodableValue("windowId")] = flutter::EncodableValue(kv.first);
        m[flutter::EncodableValue("title")] = flutter::EncodableValue(WideToUtf8(title));
        m[flutter::EncodableValue("focused")] =
            flutter::EncodableValue(kv.second.hwnd == fg);
        m[flutter::EncodableValue("width")] =
            flutter::EncodableValue(static_cast<int32_t>(rc.right - rc.left));
        m[flutter::EncodableValue("height")] =
            flutter::EncodableValue(static_cast<int32_t>(rc.bottom - rc.top));
        list.push_back(flutter::EncodableValue(m));
      }
      result->Success(flutter::EncodableValue(list));
      return;
    }

    if (name == "captureFrame") {
      HWND hwnd = ResolveCaptureHwnd();
      std::vector<uint8_t> rgba;
      int w = 0, h = 0;
      if (!CaptureHwndToRgba(hwnd, rgba, w, h)) {
        result->Success(flutter::EncodableValue());
        return;
      }
      std::string window_id;
      std::string title;
      {
        std::lock_guard<std::mutex> lock(g_mutex);
        for (const auto& kv : g_windows) {
          if (kv.second.hwnd == hwnd) {
            window_id = kv.first;
            title = WideToUtf8(kv.second.title);
            break;
          }
        }
      }
      flutter::EncodableMap m;
      m[flutter::EncodableValue("format")] = flutter::EncodableValue("bgra");
      m[flutter::EncodableValue("pixels")] =
          flutter::EncodableValue(std::vector<uint8_t>(rgba.begin(), rgba.end()));
      m[flutter::EncodableValue("jpeg")] = flutter::EncodableValue(std::vector<uint8_t>());
      m[flutter::EncodableValue("width")] = flutter::EncodableValue(w);
      m[flutter::EncodableValue("height")] = flutter::EncodableValue(h);
      m[flutter::EncodableValue("windowId")] = flutter::EncodableValue(window_id);
      m[flutter::EncodableValue("title")] = flutter::EncodableValue(title);
      result->Success(flutter::EncodableValue(m));
      return;
    }

    if (name == "injectInput") {
      if (!args) {
        result->Success();
        return;
      }
      HWND hwnd = ResolveCaptureHwnd();
      auto type_it = args->find(flutter::EncodableValue("type"));
      std::string type;
      if (type_it != args->end()) type = std::get<std::string>(type_it->second);
      auto x_it = args->find(flutter::EncodableValue("x"));
      auto y_it = args->find(flutter::EncodableValue("y"));
      int x = 0, y = 0;
      if (x_it != args->end()) x = std::get<int32_t>(x_it->second);
      if (y_it != args->end()) y = std::get<int32_t>(y_it->second);
      if (type == "click") {
        std::string button = "left";
        auto b_it = args->find(flutter::EncodableValue("button"));
        if (b_it != args->end()) button = std::get<std::string>(b_it->second);
        InjectClick(hwnd, x, y, button);
      } else if (type == "wheel") {
        double dy = 0;
        auto dy_it = args->find(flutter::EncodableValue("deltaY"));
        if (dy_it != args->end()) dy = std::get<double>(dy_it->second);
        InjectWheel(hwnd, x, y, dy);
      } else if (type == "keydown") {
        std::string key;
        auto k_it = args->find(flutter::EncodableValue("key"));
        if (k_it != args->end()) key = std::get<std::string>(k_it->second);
        InjectKey(hwnd, key);
      } else if (type == "type") {
        std::string text;
        auto t_it = args->find(flutter::EncodableValue("text"));
        if (t_it != args->end()) text = std::get<std::string>(t_it->second);
        InjectType(hwnd, text);
      }
      result->Success();
      return;
    }

    result->NotImplemented();
  }
};

}  // namespace

void LiminalRemoteDesktopSetMainWindowHandle(void* hwnd) {
  g_main_hwnd = static_cast<HWND>(hwnd);
}

void LiminalRemoteDesktopPluginRegisterWithRegistrar(
    FlutterDesktopPluginRegistrarRef registrar) {
  LiminalRemoteDesktopPlugin::RegisterWithRegistrar(
      flutter::PluginRegistrarManager::GetInstance()
          ->GetRegistrar<flutter::PluginRegistrarWindows>(registrar));
}

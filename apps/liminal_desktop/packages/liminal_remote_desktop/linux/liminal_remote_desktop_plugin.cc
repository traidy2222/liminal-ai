#include <flutter_linux/flutter_linux.h>
#include <gtk/gtk.h>
#include <gdk/gdkx.h>

#include <cstring>
#include <map>
#include <string>
#include <vector>

#include <X11/Xlib.h>
#include <X11/extensions/XTest.h>
#include <X11/Xutil.h>

static std::map<std::string, Window> g_x11_windows;
static std::string g_capture_target;
static std::string g_main_id;
static Display* g_display = nullptr;

static Display* display() {
  if (!g_display) g_display = XOpenDisplay(nullptr);
  return g_display;
}

static Window resolve_hwnd() {
  Display* dpy = display();
  if (!dpy) return 0;
  Window fg = XGetInputFocus(dpy, nullptr, nullptr);
  for (const auto& kv : g_x11_windows) {
    if (kv.second == fg) return fg;
  }
  if (!g_capture_target.empty()) {
    auto it = g_x11_windows.find(g_capture_target);
    if (it != g_x11_windows.end()) return it->second;
  }
  if (!g_main_id.empty()) {
    auto it = g_x11_windows.find(g_main_id);
    if (it != g_x11_windows.end()) return it->second;
  }
  if (!g_x11_windows.empty()) return g_x11_windows.begin()->second;
  return 0;
}

static FlValue* capture_frame_value() {
  Display* dpy = display();
  Window win = resolve_hwnd();
  if (!dpy || !win) return nullptr;
  XWindowAttributes attr{};
  if (!XGetWindowAttributes(dpy, win, &attr)) return nullptr;
  int w = attr.width;
  int h = attr.height;
  if (w <= 0 || h <= 0) return nullptr;
  XImage* img = XGetImage(dpy, win, 0, 0, w, h, AllPlanes, ZPixmap);
  if (!img) return nullptr;
  std::vector<uint8_t> rgba(static_cast<size_t>(w) * h * 4);
  for (int y = 0; y < h; y++) {
    for (int x = 0; x < w; x++) {
      unsigned long pixel = XGetPixel(img, x, y);
      size_t i = static_cast<size_t>((y * w + x) * 4);
      rgba[i] = (pixel >> 16) & 0xff;
      rgba[i + 1] = (pixel >> 8) & 0xff;
      rgba[i + 2] = pixel & 0xff;
      rgba[i + 3] = 0xff;
    }
  }
  XDestroyImage(img);
  g_autoptr(FlValue) map = fl_value_new_map();
  g_autoptr(FlValue) bytes = fl_value_new_uint8_list(rgba.data(), rgba.size());
  fl_value_set_string_take(map, "format", fl_value_new_string("rgba"));
  fl_value_set_string_take(map, "pixels", fl_value_ref(bytes));
  fl_value_set_string_take(map, "jpeg", fl_value_new_uint8_list(nullptr, 0));
  fl_value_set_string_take(map, "width", fl_value_new_int(w));
  fl_value_set_string_take(map, "height", fl_value_new_int(h));
  fl_value_set_string_take(map, "windowId", fl_value_new_string(g_main_id.c_str()));
  fl_value_set_string_take(map, "title", fl_value_new_string("Liminal"));
  return fl_value_ref(map);
}

static void inject_input(FlValue* args) {
  if (!args || fl_value_get_type(args) != FL_VALUE_TYPE_MAP) return;
  Display* dpy = display();
  Window win = resolve_hwnd();
  if (!dpy || !win) return;
  FlValue* type_v = fl_value_lookup_string(args, "type");
  const char* type = type_v ? fl_value_get_string(type_v) : "";
  int x = 0, y = 0;
  FlValue* x_v = fl_value_lookup_string(args, "x");
  FlValue* y_v = fl_value_lookup_string(args, "y");
  if (x_v) x = fl_value_get_int(x_v);
  if (y_v) y = fl_value_get_int(y_v);
  XWindowAttributes attr{};
  XGetWindowAttributes(dpy, win, &attr);
  int sx = attr.x + x;
  int sy = attr.y + y;
  if (strcmp(type, "click") == 0) {
    XTestFakeMotionEvent(dpy, 0, sx, sy, CurrentTime);
    XTestFakeButtonEvent(dpy, 1, True, CurrentTime);
    XTestFakeButtonEvent(dpy, 1, False, CurrentTime);
  } else if (strcmp(type, "wheel") == 0) {
    FlValue* dy_v = fl_value_lookup_string(args, "deltaY");
    int dy = dy_v ? static_cast<int>(fl_value_get_float(dy_v)) : 0;
    int btn = dy < 0 ? 4 : 5;
    XTestFakeButtonEvent(dpy, btn, True, CurrentTime);
    XTestFakeButtonEvent(dpy, btn, False, CurrentTime);
  }
  XFlush(dpy);
}

static void method_call_cb(FlMethodChannel* channel, FlMethodCall* method_call,
                           gpointer user_data) {
  const gchar* method = fl_method_call_get_name(method_call);
  FlValue* args = fl_method_call_get_args(method_call);
  g_autoptr(FlMethodResponse) response = nullptr;

  if (strcmp(method, "registerWindow") == 0) {
    FlValue* id_v = fl_value_lookup_string(args, "windowId");
    FlValue* main_v = fl_value_lookup_string(args, "isMain");
    const char* id = id_v ? fl_value_get_string(id_v) : "main";
    bool is_main = main_v && fl_value_get_bool(main_v);
    GdkWindow* gdk = gtk_widget_get_window(GTK_WIDGET(
        fl_plugin_registrar_get_view(FL_PLUGIN_REGISTRAR(user_data))));
    if (gdk) {
      g_x11_windows[id] = GDK_WINDOW_XID(gdk);
      if (is_main) g_main_id = id;
    }
    response = FL_METHOD_RESPONSE(fl_method_success_response_new(nullptr));
  } else if (strcmp(method, "unregisterWindow") == 0) {
    FlValue* id_v = fl_value_lookup_string(args, "windowId");
    if (id_v) g_x11_windows.erase(fl_value_get_string(id_v));
    response = FL_METHOD_RESPONSE(fl_method_success_response_new(nullptr));
  } else if (strcmp(method, "setCaptureTarget") == 0) {
    FlValue* id_v = fl_value_lookup_string(args, "windowId");
    g_capture_target = id_v ? fl_value_get_string(id_v) : "";
    response = FL_METHOD_RESPONSE(fl_method_success_response_new(nullptr));
  } else if (strcmp(method, "listWindows") == 0) {
    g_autoptr(FlValue) list = fl_value_new_list();
    for (const auto& kv : g_x11_windows) {
      g_autoptr(FlValue) m = fl_value_new_map();
      fl_value_set_string_take(m, "windowId", fl_value_new_string(kv.first.c_str()));
      fl_value_set_string_take(m, "title", fl_value_new_string("Liminal"));
      fl_value_set_string_take(m, "focused", fl_value_new_bool(false));
      fl_value_set_string_take(m, "width", fl_value_new_int(1280));
      fl_value_set_string_take(m, "height", fl_value_new_int(720));
      fl_value_append_take(list, fl_value_ref(m));
    }
    response = FL_METHOD_RESPONSE(fl_method_success_response_new(list));
  } else if (strcmp(method, "captureFrame") == 0) {
    FlValue* frame = capture_frame_value();
    response = FL_METHOD_RESPONSE(fl_method_success_response_new(frame));
  } else if (strcmp(method, "injectInput") == 0) {
    inject_input(args);
    response = FL_METHOD_RESPONSE(fl_method_success_response_new(nullptr));
  } else {
    response = FL_METHOD_RESPONSE(fl_method_not_implemented_response_new());
  }
  fl_method_call_respond(method_call, response, nullptr);
}

void liminal_remote_desktop_plugin_register_with_registrar(FlPluginRegistrar* registrar) {
  g_autoptr(FlStandardMethodCodec) codec = fl_standard_method_codec_new();
  g_autoptr(FlMethodChannel) channel = fl_method_channel_new(
      fl_plugin_registrar_get_messenger(registrar),
      "liminal/remote_desktop", FL_METHOD_CODEC(codec));
  fl_method_channel_set_method_call_handler(channel, method_call_cb,
                                            g_object_ref(registrar), g_object_unref);
}

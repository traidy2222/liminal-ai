import Cocoa
import FlutterMacOS
import CoreGraphics

public class LiminalRemoteDesktopPlugin: NSObject, FlutterPlugin {
  private var windows: [String: NSWindow] = [:]
  private var captureTarget: String?
  private var mainWindowId: String?
  private weak var hostWindow: NSWindow?

  public static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(
      name: "liminal/remote_desktop", binaryMessenger: registrar.messenger)
    let instance = LiminalRemoteDesktopPlugin()
    instance.hostWindow = registrar.view?.window
    registrar.addMethodCallDelegate(instance, channel: channel)
    if let window = instance.hostWindow ?? NSApplication.shared.mainWindow {
      instance.windows["main"] = window
      instance.mainWindowId = "main"
    }
  }

  private func resolveWindow() -> NSWindow? {
    if let id = captureTarget, let w = windows[id] { return w }
    if let key = NSApplication.shared.keyWindow, windows.values.contains(where: { $0 === key }) {
      return key
    }
    if let id = mainWindowId, let w = windows[id] { return w }
    return windows.values.first
  }

  public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "registerWindow":
      guard let args = call.arguments as? [String: Any],
            let windowId = args["windowId"] as? String else {
        result(nil)
        return
      }
      let isMain = args["isMain"] as? Bool ?? false
      let win = hostWindow ?? NSApplication.shared.mainWindow
      if let win {
        windows[windowId] = win
        if isMain || windowId == "main" {
          mainWindowId = windowId
        }
      }
      result(nil)
    case "unregisterWindow":
      if let args = call.arguments as? [String: Any],
         let windowId = args["windowId"] as? String {
        windows.removeValue(forKey: windowId)
      }
      result(nil)
    case "setCaptureTarget":
      if let args = call.arguments as? [String: Any] {
        captureTarget = args["windowId"] as? String
      }
      result(nil)
    case "listWindows":
      var list: [[String: Any]] = []
      let key = NSApplication.shared.keyWindow
      for (id, win) in windows {
        let frame = win.frame
        list.append([
          "windowId": id,
          "title": win.title,
          "focused": win === key,
          "width": Int(frame.width),
          "height": Int(frame.height),
        ])
      }
      result(list)
    case "captureFrame":
      guard let win = resolveWindow(),
            let contentView = win.contentView else {
        result(nil)
        return
      }
      let rect = contentView.bounds
      let w = Int(rect.width)
      let h = Int(rect.height)
      guard w > 0, h > 0,
            let rep = contentView.bitmapImageRepForCachingDisplay(in: rect) else {
        result(nil)
        return
      }
      contentView.cacheDisplay(in: rect, to: rep)
      guard let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.72]) else {
        result(nil)
        return
      }
      var windowId = ""
      for (id, candidate) in windows where candidate === win { windowId = id; break }
      result([
        "jpeg": FlutterStandardTypedData(bytes: data),
        "width": w,
        "height": h,
        "windowId": windowId,
        "title": win.title,
      ])
    case "injectInput":
      guard let win = resolveWindow(),
            let args = call.arguments as? [String: Any],
            let type = args["type"] as? String else {
        result(nil)
        return
      }
      win.makeKeyAndOrderFront(nil)
      let x = args["x"] as? Int ?? 0
      let y = args["y"] as? Int ?? 0
      let contentH = win.contentView?.bounds.height ?? 0
      let screenY = win.frame.origin.y + (contentH - CGFloat(y))
      let screenX = win.frame.origin.x + CGFloat(x)
      let point = CGPoint(x: screenX, y: screenY)
      if type == "click" {
        let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
        let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
      } else if type == "wheel" {
        let dy = args["deltaY"] as? Double ?? 0
        let ev = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: Int32(-dy), wheel2: 0, wheel3: 0)
        ev?.location = point
        ev?.post(tap: .cghidEventTap)
      } else if type == "keydown", let key = args["key"] as? String {
        postKey(key)
      } else if type == "type", let text = args["text"] as? String {
        for ch in text { postKey(String(ch)) }
      }
      result(nil)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func postKey(_ key: String) {
    if key == "Enter" {
      postVirtualKey(36)
    } else if key == "Backspace" {
      postVirtualKey(51)
    } else if key.count == 1, let scalar = key.unicodeScalars.first {
      let ev = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
      var uni = UniChar(scalar.value)
      ev?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &uni)
      ev?.post(tap: .cghidEventTap)
      let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
      up?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &uni)
      up?.post(tap: .cghidEventTap)
    }
  }

  private func postVirtualKey(_ code: CGKeyCode) {
    let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)
    let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
    down?.post(tap: .cghidEventTap)
    up?.post(tap: .cghidEventTap)
  }
}

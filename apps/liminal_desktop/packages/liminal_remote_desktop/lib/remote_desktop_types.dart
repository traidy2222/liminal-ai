class RemoteDesktopWindowInfo {
  const RemoteDesktopWindowInfo({
    required this.windowId,
    required this.title,
    required this.focused,
    required this.width,
    required this.height,
  });

  final String windowId;
  final String title;
  final bool focused;
  final int width;
  final int height;

  factory RemoteDesktopWindowInfo.fromJson(Map<String, dynamic> json) {
    return RemoteDesktopWindowInfo(
      windowId: json['windowId'] as String? ?? '',
      title: json['title'] as String? ?? '',
      focused: json['focused'] as bool? ?? false,
      width: (json['width'] as num?)?.toInt() ?? 0,
      height: (json['height'] as num?)?.toInt() ?? 0,
    );
  }
}

class RemoteDesktopFrame {
  const RemoteDesktopFrame({
    required this.jpeg,
    required this.pixels,
    required this.pixelFormat,
    required this.width,
    required this.height,
    required this.windowId,
    required this.title,
  });

  final List<int> jpeg;
  final List<int> pixels;
  final String? pixelFormat;
  final int width;
  final int height;
  final String windowId;
  final String title;

  factory RemoteDesktopFrame.fromJson(Map<String, dynamic> json) {
    final jpegRaw = json['jpeg'];
    final pxRaw = json['pixels'];
    return RemoteDesktopFrame(
      jpeg: jpegRaw is List ? jpegRaw.cast<int>() : const [],
      pixels: pxRaw is List ? pxRaw.cast<int>() : const [],
      pixelFormat: json['format'] as String?,
      width: (json['width'] as num?)?.toInt() ?? 0,
      height: (json['height'] as num?)?.toInt() ?? 0,
      windowId: json['windowId'] as String? ?? '',
      title: json['title'] as String? ?? '',
    );
  }
}

class RemoteDesktopInputEvent {
  const RemoteDesktopInputEvent({
    required this.type,
    this.x,
    this.y,
    this.button,
    this.deltaX,
    this.deltaY,
    this.key,
    this.text,
  });

  final String type;
  final int? x;
  final int? y;
  final String? button;
  final double? deltaX;
  final double? deltaY;
  final String? key;
  final String? text;

  Map<String, dynamic> toJson() => {
        'type': type,
        if (x != null) 'x': x,
        if (y != null) 'y': y,
        if (button != null) 'button': button,
        if (deltaX != null) 'deltaX': deltaX,
        if (deltaY != null) 'deltaY': deltaY,
        if (key != null) 'key': key,
        if (text != null) 'text': text,
      };

  factory RemoteDesktopInputEvent.fromJson(Map<String, dynamic> json) {
    return RemoteDesktopInputEvent(
      type: json['type'] as String? ?? '',
      x: (json['x'] as num?)?.toInt(),
      y: (json['y'] as num?)?.toInt(),
      button: json['button'] as String?,
      deltaX: (json['deltaX'] as num?)?.toDouble(),
      deltaY: (json['deltaY'] as num?)?.toDouble(),
      key: json['key'] as String?,
      text: json['text'] as String?,
    );
  }
}

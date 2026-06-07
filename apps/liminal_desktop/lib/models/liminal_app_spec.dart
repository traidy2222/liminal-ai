/// Wire types for `~/.liminal/apps/` desktop app specs and cache entries.

class LiminalAppShell {
  const LiminalAppShell({
    this.mode = 'widget',
    this.frameless = true,
    this.alwaysOnTop = false,
    this.skipTaskbar = false,
    this.opacity = 1,
  });

  final String mode;
  final bool frameless;
  final bool alwaysOnTop;
  final bool skipTaskbar;
  final double opacity;

  bool get isWidget => mode != 'window';

  factory LiminalAppShell.widgetDefaults() => const LiminalAppShell();

  factory LiminalAppShell.fromJson(Map<String, dynamic>? json) {
    if (json == null) return LiminalAppShell.widgetDefaults();
    final mode = json['mode'] == 'window' ? 'window' : 'widget';
    final isWidget = mode != 'window';
    final opacityRaw = (json['opacity'] as num?)?.toDouble();
    final opacity = opacityRaw != null && opacityRaw >= 0.5 && opacityRaw <= 1
        ? opacityRaw
        : 1.0;
    return LiminalAppShell(
      mode: mode,
      frameless: json['frameless'] == false ? false : isWidget,
      alwaysOnTop: json['always_on_top'] as bool? ?? false,
      skipTaskbar: json['skip_taskbar'] as bool? ?? false,
      opacity: opacity,
    );
  }

  Map<String, dynamic> toJson() => {
        'mode': mode,
        'frameless': frameless,
        'always_on_top': alwaysOnTop,
        'skip_taskbar': skipTaskbar,
        if (opacity < 1) 'opacity': opacity,
      };
}

class LiminalAppSpec {
  LiminalAppSpec({
    required this.id,
    required this.type,
    required this.title,
    required this.props,
    this.refreshIntervalMin,
    this.placementWidth,
    this.placementHeight,
    this.placementX,
    this.placementY,
    this.shell = const LiminalAppShell(),
    this.autoOpen = false,
    required this.createdAt,
    required this.updatedAt,
    required this.source,
  });

  final String id;
  final String type;
  final String title;
  final Map<String, dynamic> props;
  final int? refreshIntervalMin;
  final int? placementWidth;
  final int? placementHeight;
  final double? placementX;
  final double? placementY;
  final LiminalAppShell shell;
  final bool autoOpen;
  final int createdAt;
  final int updatedAt;
  final String source;

  bool get isWidgetMode => shell.isWidget;

  int get effectiveWidth => placementWidth ?? 320;
  int get effectiveHeight => placementHeight ?? 280;

  factory LiminalAppSpec.fromJson(Map<String, dynamic> json) {
    final refresh = json['refresh'];
    final placement = json['placement'];
    return LiminalAppSpec(
      id: json['id'] as String? ?? '',
      type: json['type'] as String? ?? '',
      title: json['title'] as String? ?? '',
      props: json['props'] is Map
          ? Map<String, dynamic>.from(json['props'] as Map)
          : const {},
      refreshIntervalMin: refresh is Map
          ? (refresh['interval_min'] as num?)?.toInt()
          : null,
      placementWidth: placement is Map
          ? (placement['width'] as num?)?.toInt()
          : null,
      placementHeight: placement is Map
          ? (placement['height'] as num?)?.toInt()
          : null,
      placementX: placement is Map ? (placement['x'] as num?)?.toDouble() : null,
      placementY: placement is Map ? (placement['y'] as num?)?.toDouble() : null,
      shell: LiminalAppShell.fromJson(
        json['shell'] is Map
            ? Map<String, dynamic>.from(json['shell'] as Map)
            : null,
      ),
      autoOpen: json['auto_open'] as bool? ?? false,
      createdAt: (json['created_at'] as num?)?.toInt() ?? 0,
      updatedAt: (json['updated_at'] as num?)?.toInt() ?? 0,
      source: json['source'] as String? ?? 'model',
    );
  }

  Map<String, dynamic> toJson() => {
        'v': 1,
        'id': id,
        'type': type,
        'title': title,
        'props': props,
        if (refreshIntervalMin != null)
          'refresh': {'interval_min': refreshIntervalMin},
        if (placementWidth != null && placementHeight != null)
          'placement': {
            'width': placementWidth,
            'height': placementHeight,
            if (placementX != null) 'x': placementX,
            if (placementY != null) 'y': placementY,
          },
        'shell': shell.toJson(),
        'auto_open': autoOpen,
        'created_at': createdAt,
        'updated_at': updatedAt,
        'source': source,
      };
}

class AppCacheEntry {
  AppCacheEntry({
    required this.fetchedAt,
    required this.ok,
    this.data,
    this.error,
  });

  final int fetchedAt;
  final bool ok;
  final Map<String, dynamic>? data;
  final String? error;

  factory AppCacheEntry.fromJson(Map<String, dynamic> json) {
    final rawData = json['data'];
    return AppCacheEntry(
      fetchedAt: (json['fetched_at'] as num?)?.toInt() ?? 0,
      ok: json['ok'] as bool? ?? false,
      data: rawData is Map ? Map<String, dynamic>.from(rawData) : null,
      error: json['error'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'fetched_at': fetchedAt,
        'ok': ok,
        if (data != null) 'data': data,
        if (error != null) 'error': error,
      };
}

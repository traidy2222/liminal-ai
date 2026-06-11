/// Live browser panel state from sidecar `browser_view` events.
class BrowserViewState {
  const BrowserViewState({
    required this.sessionId,
    required this.url,
    this.title,
    this.imageRelPath,
    required this.open,
    required this.updatedAt,
    this.viewportWidth = 1280,
    this.viewportHeight = 800,
    this.liveStream = false,
    this.embedMode = 'webview',
  });

  final String sessionId;
  final String url;
  final String? title;
  final String? imageRelPath;
  final bool open;
  final int updatedAt;
  final int viewportWidth;
  final int viewportHeight;
  final bool liveStream;
  final String embedMode;

  factory BrowserViewState.fromWire(Map<String, dynamic> data) {
    final mode = data['embedMode'] as String?;
    return BrowserViewState(
      sessionId: data['sessionId'] as String? ?? '',
      url: data['url'] as String? ?? '',
      title: data['title'] as String?,
      imageRelPath: data['imagePath'] as String?,
      open: data['open'] as bool? ?? false,
      updatedAt: (data['updatedAt'] as num?)?.toInt() ?? 0,
      viewportWidth: (data['viewportWidth'] as num?)?.toInt() ?? 1280,
      viewportHeight: (data['viewportHeight'] as num?)?.toInt() ?? 800,
      liveStream: data['liveStream'] as bool? ?? false,
      embedMode: mode == 'screencast' ? 'screencast' : 'webview',
    );
  }
}

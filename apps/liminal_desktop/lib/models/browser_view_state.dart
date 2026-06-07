/// Live browser panel state from sidecar `browser_view` events.
class BrowserViewState {
  const BrowserViewState({
    required this.sessionId,
    required this.url,
    this.title,
    this.imageRelPath,
    required this.open,
    required this.updatedAt,
  });

  final String sessionId;
  final String url;
  final String? title;
  final String? imageRelPath;
  final bool open;
  final int updatedAt;

  factory BrowserViewState.fromWire(Map<String, dynamic> data) {
    return BrowserViewState(
      sessionId: data['sessionId'] as String? ?? '',
      url: data['url'] as String? ?? '',
      title: data['title'] as String?,
      imageRelPath: data['imagePath'] as String?,
      open: data['open'] as bool? ?? false,
      updatedAt: (data['updatedAt'] as num?)?.toInt() ?? 0,
    );
  }
}

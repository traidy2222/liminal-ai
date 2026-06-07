import 'package:flutter/foundation.dart';

/// Resolves image `src` for markdown (https, data URLs, workspace-relative paths).
class AssetUrlResolver extends ChangeNotifier {
  AssetUrlResolver();

  int? _port;
  String? _token;
  String? _chatId;

  void configure({required int port, required String token, String? chatId}) {
    _port = port;
    _token = token;
    _chatId = chatId;
    notifyListeners();
  }

  void clear() {
    _port = null;
    _token = null;
    _chatId = null;
    notifyListeners();
  }

  String? resolveBrowserPreview(String sessionId, int updatedAt) {
    if (sessionId.trim().isEmpty) return null;
    final port = _port;
    final token = _token;
    if (port == null || token == null) return null;
    final chatParam =
        _chatId != null ? '&chatId=${Uri.encodeComponent(_chatId!)}' : '';
    return 'http://127.0.0.1:$port/browser_preview'
        '?token=${Uri.encodeComponent(token)}'
        '&sessionId=${Uri.encodeComponent(sessionId)}'
        '$chatParam&v=$updatedAt';
  }

  String? resolveImageSrc(String? src) {
    if (src == null || src.trim().isEmpty) return null;
    final s = src.trim();
    final lower = s.toLowerCase();
    if (lower.startsWith('https://') ||
        lower.startsWith('http://') ||
        lower.startsWith('data:image/')) {
      return s;
    }
    if (lower.startsWith('file://') || lower.startsWith('javascript:')) {
      return null;
    }
    final port = _port;
    final token = _token;
    if (port == null || token == null) return null;

    var rel = s;
    if (rel.startsWith('/')) rel = rel.substring(1);
    final chatParam = _chatId != null ? '&chatId=${Uri.encodeComponent(_chatId!)}' : '';
    return 'http://127.0.0.1:$port/media?token=${Uri.encodeComponent(token)}'
        '&path=${Uri.encodeComponent(rel)}$chatParam';
  }
}

final assetUrlResolver = AssetUrlResolver();

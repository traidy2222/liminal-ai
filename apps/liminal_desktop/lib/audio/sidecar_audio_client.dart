import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'tts_clip.dart';

class TranscribeResult {
  TranscribeResult({
    required this.text,
    this.language,
    this.durationSec,
    this.costUsd = 0,
    this.model = '',
  });

  final String text;
  final String? language;
  final double? durationSec;
  final double costUsd;
  final String model;
}

/// HTTP client for sidecar audio routes (`/api/audio/*`, `/api/tts/*`).
class SidecarAudioClient {
  SidecarAudioClient({
    required this.port,
    required this.token,
    required this.chatId,
  });

  final int port;
  final String token;
  final String chatId;

  Uri _uri(String path, {Map<String, String>? query}) {
    final q = <String, String>{
      'token': token,
      'chatId': chatId,
      ...?query,
    };
    return Uri(
      scheme: 'http',
      host: '127.0.0.1',
      port: port,
      path: path,
      queryParameters: q,
    );
  }

  String resolveAudioUrl(String audioUrl) {
    if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
      return audioUrl;
    }
    final path = audioUrl.startsWith('/') ? audioUrl : '/$audioUrl';
    return _uri(path).toString();
  }

  /// Download a token-gated `/api/tts/clip/*` URL (web fetches blob before play).
  Future<TtsClipBytes> fetchTtsClip(String audioUrl) async {
    final resolved = resolveAudioUrl(audioUrl);
    final client = HttpClient();
    try {
      final req = await client.getUrl(Uri.parse(resolved));
      final resp = await req.close();
      final chunks = <List<int>>[];
      await for (final chunk in resp) {
        chunks.add(chunk);
      }
      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        final errBody = utf8.decode(
          chunks.expand((c) => c).toList(),
          allowMalformed: true,
        );
        final err = _parseError(errBody) ?? 'TTS clip HTTP ${resp.statusCode}';
        throw HttpException(err);
      }
      final bytes = Uint8List.fromList(chunks.expand((c) => c).toList());
      if (bytes.isEmpty) {
        throw const HttpException('TTS clip is empty');
      }
      final mime = resp.headers.contentType?.mimeType ?? 'audio/mpeg';
      return TtsClipBytes(bytes: bytes, mimeType: mime);
    } finally {
      client.close(force: true);
    }
  }

  Future<String> uploadWavBytes(Uint8List bytes, {String filename = 'dictation.wav'}) async {
    final b64 = base64Encode(bytes);
    final dataUrl = 'data:audio/wav;base64,$b64';
    final client = HttpClient();
    try {
      final req = await client.postUrl(_uri('/api/audio/upload'));
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode({
        'dataUrl': dataUrl,
        'filename': filename,
        'mimeType': 'audio/wav',
      }));
      final resp = await req.close();
      final body = await resp.transform(utf8.decoder).join();
      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        final err = _parseError(body) ?? 'Upload failed HTTP ${resp.statusCode}';
        throw HttpException(err);
      }
      final json = jsonDecode(body) as Map<String, dynamic>;
      final id = json['attachmentId'] as String?;
      if (id == null || id.isEmpty) {
        throw const HttpException('Upload response missing attachmentId');
      }
      return id;
    } finally {
      client.close(force: true);
    }
  }

  Future<TranscribeResult?> transcribe(String attachmentId) async {
    final client = HttpClient();
    try {
      final req = await client.postUrl(_uri('/api/transcribe'));
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode({'attachmentId': attachmentId}));
      final resp = await req.close();
      final body = await resp.transform(utf8.decoder).join();
      if (resp.statusCode == 503) return null;
      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        final err = _parseError(body) ?? 'Transcribe failed HTTP ${resp.statusCode}';
        throw HttpException(err);
      }
      final json = jsonDecode(body) as Map<String, dynamic>;
      return TranscribeResult(
        text: (json['text'] as String? ?? '').trim(),
        language: json['language'] as String?,
        durationSec: (json['durationSec'] as num?)?.toDouble(),
        costUsd: (json['costUsd'] as num?)?.toDouble() ?? 0,
        model: json['model'] as String? ?? '',
      );
    } finally {
      client.close(force: true);
    }
  }

  String? _parseError(String body) {
    try {
      final j = jsonDecode(body) as Map<String, dynamic>;
      final err = j['error'];
      if (err is String && err.isNotEmpty) return err;
      if (err is Map) {
        final msg = err['message'];
        if (msg is String && msg.isNotEmpty) return msg;
      }
      final msg = j['message'];
      if (msg is String && msg.isNotEmpty) return msg;
    } catch (_) {}
    return body.isNotEmpty ? body : null;
  }
}

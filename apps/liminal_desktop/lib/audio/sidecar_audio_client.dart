import 'dart:async';
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
    this.clipTimeout = const Duration(seconds: 25),
  });

  final int port;
  final String token;
  final String chatId;
  final Duration clipTimeout;
  final Set<HttpClient> _transcriptionClients = {};
  void cancelTranscriptionRequests() {
    for (final client in _transcriptionClients.toList()) {
      client.close(force: true);
    }
    _transcriptionClients.clear();
  }

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
    Future<TtsClipBytes> download() async {
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
    }
    try {
      return await download().timeout(clipTimeout);
    } finally {
      client.close(force: true);
    }
  }

  Future<String> uploadWavBytes(
    Uint8List bytes, {
    String filename = 'dictation.wav',
  }) async {
    final json = await _postJson(
        '/api/audio/upload',
        {
          'dataUrl': 'data:audio/wav;base64,${base64Encode(bytes)}',
          'filename': filename,
          'mimeType': 'audio/wav',
        },
        timeout: const Duration(seconds: 30));
    final id = json['attachmentId'] as String?;
    if (id == null || id.isEmpty) {
      throw const HttpException('Upload response missing attachmentId');
    }
    return id;
  }

  Future<String> preview(Uint8List wav) async {
    final json =
        await _postJson('/api/transcribe', {'previewWav': base64Encode(wav)});
    return json['text'] as String? ?? '';
  }

  Future<TranscribeResult?> transcribe(String attachmentId) async {
    final json =
        await _postJson('/api/transcribe', {'attachmentId': attachmentId});
    return TranscribeResult(
      text: (json['text'] as String? ?? '').trim(),
      language: json['language'] as String?,
      durationSec: (json['durationSec'] as num?)?.toDouble(),
      costUsd: (json['costUsd'] as num?)?.toDouble() ?? 0,
      model: json['model'] as String? ?? '',
    );
  }

  Future<Map<String, dynamic>> _postJson(
      String route, Map<String, dynamic> data,
      {Duration timeout = const Duration(seconds: 150)}) async {
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 10);
    _transcriptionClients.add(client);
    Future<Map<String, dynamic>> post() async {
      final req = await client.postUrl(_uri(route));
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode(data));
      final response = await req.close();
      final body = await response.transform(utf8.decoder).join();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw HttpException(_parseError(body) ??
            'Audio request failed HTTP ${response.statusCode}');
      }
      return jsonDecode(body) as Map<String, dynamic>;
    }

    try {
      return await post().timeout(timeout, onTimeout: () {
        client.close(force: true);
        throw TimeoutException(
            'Transcription connection timed out. Please try again.');
      });
    } finally {
      _transcriptionClients.remove(client);
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

import 'dart:typed_data';

/// Bytes + MIME type for a synthesized TTS clip from the sidecar.
class TtsClipBytes {
  TtsClipBytes({required this.bytes, required this.mimeType});

  final Uint8List bytes;
  final String mimeType;
}

typedef TtsClipFetcher = Future<TtsClipBytes> Function(String audioUrl);

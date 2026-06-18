import 'dart:convert';
import 'dart:typed_data';

/// Outbound chat attachment (images + any file; web `ImageAttachment` parity).
class UserImageAttachment {
  UserImageAttachment({
    required this.name,
    required this.mimeType,
    required this.bytes,
    this.source = 'clipboard',
  });

  final String name;
  final String mimeType;
  final Uint8List bytes;
  final String source;

  bool get isImage => mimeType.startsWith('image/');

  int get sizeBytes => bytes.length;

  String get dataUrl =>
      'data:$mimeType;base64,${base64Encode(bytes)}';

  Map<String, dynamic> toWire() => {
        'name': name,
        'mimeType': mimeType,
        'dataUrl': dataUrl,
        'sizeBytes': sizeBytes,
        'source': source,
      };
}

import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/services.dart';
import 'package:mime/mime.dart';
import 'package:pasteboard/pasteboard.dart';

import '../../models/user_image_attachment.dart';

/// Clipboard helpers for the chat composer (image paste parity with web UI).
abstract final class ComposerClipboard {
  static Future<Uint8List?> readImageBytes() async {
    try {
      final bytes = await Pasteboard.image;
      if (bytes == null || bytes.isEmpty) return null;
      return bytes;
    } catch (_) {
      return null;
    }
  }

  static Future<List<String>> readImageFilePaths() async {
    try {
      final paths = await Pasteboard.files();
      if (paths.isEmpty) return const [];
      return paths.where(_looksLikeImagePath).toList(growable: false);
    } catch (_) {
      return const [];
    }
  }

  static Future<String?> readPlainText() async {
    try {
      final text = await Pasteboard.text;
      if (text != null && text.isNotEmpty) return text;
    } catch (_) {
      // Fall through to Flutter clipboard.
    }
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text;
    if (text == null || text.isEmpty) return null;
    return text;
  }

  static bool _looksLikeImagePath(String path) {
    final mime = lookupMimeType(path);
    if (mime != null && mime.startsWith('image/')) return true;
    final lower = path.toLowerCase();
    return lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.jpeg') ||
        lower.endsWith('.gif') ||
        lower.endsWith('.webp') ||
        lower.endsWith('.bmp');
  }

  static Future<List<UserImageAttachment>> attachmentsFromPaths(
    Iterable<String> paths, {
    String source = 'clipboard',
  }) async {
    final out = <UserImageAttachment>[];
    for (final path in paths) {
      final file = File(path);
      if (!await file.exists()) continue;
      final bytes = await file.readAsBytes();
      if (bytes.isEmpty) continue;
      final name = file.uri.pathSegments.isNotEmpty
          ? file.uri.pathSegments.last
          : 'image-${DateTime.now().millisecondsSinceEpoch}.png';
      final mime = lookupMimeType(name, headerBytes: bytes) ?? 'image/png';
      if (!mime.startsWith('image/')) continue;
      out.add(
        UserImageAttachment(
          name: name,
          mimeType: mime,
          bytes: bytes,
          source: source,
        ),
      );
    }
    return out;
  }

  static UserImageAttachment attachmentFromClipboardBytes(Uint8List bytes) {
    final mime = lookupMimeType('', headerBytes: bytes) ?? 'image/png';
    return UserImageAttachment(
      name: 'pasted-${DateTime.now().millisecondsSinceEpoch}.png',
      mimeType: mime.startsWith('image/') ? mime : 'image/png',
      bytes: bytes,
      source: 'clipboard',
    );
  }
}

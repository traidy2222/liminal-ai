import 'package:flutter/services.dart';

/// Retry native startup once, after the failed controller has been disposed by
/// [create]. Navigation/authentication errors are never replayed here.
Future<T> createNativeBrowserTab<T>(Future<T> Function() create) async {
  try {
    return await create();
  } on PlatformException catch (error) {
    if (error.code != 'webview_create_failed' &&
        error.code != '[webview] native create failed.') {
      rethrow;
    }
    await Future<void>.delayed(const Duration(milliseconds: 150));
    return create();
  }
}

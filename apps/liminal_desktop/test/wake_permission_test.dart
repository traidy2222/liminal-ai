import 'dart:async';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:record/record.dart';
import 'package:liminal_desktop/audio/dictation_controller.dart';
import 'asr_review_test.dart' show RecorderFixture;

class PendingPermission extends RecorderFixture {
  final permission = Completer<bool>();
  int streams = 0;
  @override
  Future<bool> hasPermission(String id, {bool request = true}) =>
      permission.future;
  @override
  Future<Stream<Uint8List>> startStream(String id, RecordConfig config) {
    streams++;
    return super.startStream(id, config);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'turning listening off during a permission request cannot reopen the microphone later',
    () async {
      final previous = RecordPlatform.instance;
      final platform = PendingPermission();
      RecordPlatform.instance = platform;
      final capture = DictationController(wakeListening: true);
      try {
        final starting = capture.startSession();
        await Future<void>.delayed(Duration.zero);
        expect(capture.status, DictationStatus.permissionPending);
      // The recorder serializes permission and teardown. Cancel intent first,
      // then let the OS permission response settle before awaiting native cleanup.
      final ending = capture.endSession();
      expect(capture.sessionActive, isFalse);
        platform.permission.complete(true);
      await Future.wait([starting, ending]);
        expect(capture.sessionActive, isFalse);
        expect(platform.streams, 0);
      } finally {
        capture.dispose();
        await Future<void>.delayed(const Duration(milliseconds: 20));
        await platform.pcm.close();
        RecordPlatform.instance = previous;
      }
    },
  );
}

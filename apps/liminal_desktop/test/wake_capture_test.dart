import 'dart:async';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:record/record.dart';
import 'package:liminal_desktop/audio/dictation_controller.dart';
import 'package:liminal_desktop/audio/sidecar_audio_client.dart';
import 'asr_review_test.dart' show RecorderFixture;

class WakeClient extends SidecarAudioClient {
  WakeClient() : super(port: 1, token: '', chatId: 'mission-control');
  int decodes = 0;
  int uploads = 0;
  int previews = 0;
  @override
  Future<String> preview(Uint8List wav) async {
    previews++;
    throw StateError('Idle previews must stay disabled');
  }

  @override
  Future<String> uploadWavBytes(
    Uint8List bytes, {
    String filename = 'dictation.wav',
  }) async {
    uploads++;
    throw StateError('Wake audio must not be uploaded as an attachment');
  }

  @override
  Future<TranscribeResult> transcribeWake(Uint8List wav) async {
    decodes++;
    return TranscribeResult(text: 'wake utterance $decodes');
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'continuous wake capture uses PCM levels when the Windows amplitude meter stays silent',
    () async {
      final previous = RecordPlatform.instance;
      final recorder = RecorderFixture();
      RecordPlatform.instance = recorder;
      final client = WakeClient();
      final controller = DictationController(
        wakeListening: true,
        endpointOptions: const DictationEndpointOptions(
          minRecordingMs: 100,
          silenceMsShort: 150,
          silenceMsLong: 150,
        ),
      )..bindAudioClient(client);
      final sent = <String>[];
      controller.onAutoSend = (text) async {
        sent.add(text);
      };
      Future<void> waitUntil(bool Function() predicate) async {
        for (var i = 0; i < 80 && !predicate(); i++) {
          await Future<void>.delayed(const Duration(milliseconds: 50));
        }
        expect(predicate(), isTrue);
      }

      try {
        await controller.startSession();
        await Future<void>.delayed(const Duration(milliseconds: 750));
        recorder.amplitude = -70; // Deliberately stale platform meter.
        final speech = Uint8List(3200);
        final samples = ByteData.sublistView(speech);
        for (var sample = 0; sample < 1600; sample++) {
          samples.setInt16(
            sample * 2,
            sample.isEven ? 10000 : -10000,
            Endian.little,
          );
        }
        for (var i = 1; i <= 2; i++) {
          for (var frame = 0; frame < 8; frame++) {
            recorder.pcm.add(speech);
            await Future<void>.delayed(const Duration(milliseconds: 50));
          }
          await waitUntil(() => controller.status == DictationStatus.recording);
          for (var frame = 0; frame < 8; frame++) {
            recorder.pcm.add(Uint8List(3200));
            await Future<void>.delayed(const Duration(milliseconds: 50));
          }
          await waitUntil(
            () =>
                client.decodes == i &&
                controller.status == DictationStatus.listening,
          );
        }
        expect(client.uploads, 0);
        expect(client.previews, 0);
        expect(sent, ['wake utterance 1', 'wake utterance 2']);
        expect(controller.sessionActive, isTrue);
      } finally {
        await controller.endSession();
        controller.dispose();
        await Future<void>.delayed(const Duration(milliseconds: 20));
        await recorder.pcm.close();
        RecordPlatform.instance = previous;
      }
    },
  );
}

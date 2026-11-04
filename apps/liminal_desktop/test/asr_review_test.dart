import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:record/record.dart';
import 'package:liminal_desktop/audio/dictation_controller.dart';
import 'package:liminal_desktop/audio/sidecar_audio_client.dart';
import 'package:liminal_desktop/models/harness_settings.dart';
import 'package:liminal_desktop/ui/theme/liminal_theme.dart';
import 'package:liminal_desktop/ui/widgets/liminal_form_field.dart';

class RecorderFixture extends RecordPlatform {
  final pcm = StreamController<Uint8List>.broadcast();
  double amplitude = -70;
  @override
  Future<void> create(String id) async {}
  @override
  Future<bool> hasPermission(String id, {bool request = true}) async => true;
  @override
  Stream<RecordState> onStateChanged(String id) => const Stream.empty();
  @override
  Future<Stream<Uint8List>> startStream(String id, RecordConfig config) async =>
      pcm.stream;
  @override
  Future<bool> isRecording(String id) async => true;
  @override
  Future<Amplitude> getAmplitude(String id) async =>
      Amplitude(current: amplitude, max: amplitude);
  @override
  Future<void> cancel(String id) async {}
  @override
  Future<void> dispose(String id) async {}
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class UploadFixture extends SidecarAudioClient {
  UploadFixture() : super(port: 1, token: '', chatId: 'test');
  final upload = Completer<String>();
  int decodes = 0;
  @override
  Future<String> uploadWavBytes(Uint8List bytes,
          {String filename = 'dictation.wav'}) =>
      upload.future;
  @override
  Future<String> preview(Uint8List bytes) async => '';
  @override
  Future<TranscribeResult?> transcribe(String id) async {
    decodes++;
    return TranscribeResult(text: 'stale');
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('ending a session during upload cannot enqueue a stale decode',
      () async {
    final previous = RecordPlatform.instance;
    final recorder = RecorderFixture();
    RecordPlatform.instance = recorder;
    final client = UploadFixture();
    final controller = DictationController()..bindAudioClient(client);
    try {
      await controller.startSession();
      await Future<void>.delayed(const Duration(milliseconds: 750));
      recorder.amplitude = -10;
      for (var i = 0;
          i < 40 && controller.status != DictationStatus.recording;
          i++) {
        await Future<void>.delayed(const Duration(milliseconds: 50));
      }
      expect(controller.status, DictationStatus.recording);
      recorder.pcm.add(Uint8List(48000));
      await Future<void>.delayed(const Duration(milliseconds: 20));
      final pending = controller.forceSend();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(controller.status, DictationStatus.uploading);
      await controller.endSession();
      client.upload.complete('old-upload');
      await pending;
      expect(client.decodes, 0);
    } finally {
      await controller.endSession();
      controller.dispose();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      await recorder.pcm.close();
      RecordPlatform.instance = previous;
    }
  });
  testWidgets(
      'a configured cloud ASR slug stays visible in the desktop selector',
      (tester) async {
    const cloud = 'openai/whisper-large-v3-turbo';
    final field = HarnessSettingsField(
        key: 'AGENT_TRANSCRIBE_MODEL',
        label: 'Transcription mode',
        tabId: 'session_ui',
        subgroupId: 'voice',
        subgroupLabel: 'Voice',
        valueKind: 'enum',
        value: cloud,
        enumValues: ['local/whisper-large-v3-turbo', 'local/qwen3-asr-1.7b']);
    await tester.pumpWidget(MaterialApp(
        theme: buildLiminalTheme(),
        home: Scaffold(
            body: LiminalHarnessField(
                field: field, controller: null, onApply: (_) {}))));
    final dropdown = tester.widget<DropdownButtonFormField<String>>(
        find.byType(DropdownButtonFormField<String>));
    expect(dropdown.initialValue, cloud);
  });
}

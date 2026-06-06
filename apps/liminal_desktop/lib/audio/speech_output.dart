import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';

import 'tts_clip.dart';

class SpeechQueueItem {
  SpeechQueueItem({
    required this.clipId,
    required this.text,
    required this.audioUrl,
  });

  final String clipId;
  final String text;
  final String audioUrl;
}

/// TTS playback queue — mirrors web `useSpeechOutput` (fetch clip, then play).
class SpeechOutput extends ChangeNotifier {
  SpeechOutput() {
    unawaited(_player.setVolume(1));
  }

  static const micBlockAfterTtsMs = 1200;

  final AudioPlayer _player = AudioPlayer();
  final List<SpeechQueueItem> _queue = [];
  bool _playing = false;
  bool _unlocked = false;
  bool _pauseWhenCapture = false;
  bool _playbackHold = false;
  int _micBlockUntil = 0;
  int _playGen = 0;
  TtsClipFetcher? _clipFetcher;

  String? lastSpoken;
  String? playError;
  bool isSpeaking = false;
  int queueLength = 0;

  bool get ttsConfigured => _ttsConfigured;
  bool _ttsConfigured = false;

  /// True while TTS is playing or clips are queued — pause mic capture (Windows).
  void Function(bool hold)? onPlaybackHoldChange;

  void setClipFetcher(TtsClipFetcher? fetcher) {
    _clipFetcher = fetcher;
  }

  void setTtsConfigured(bool value) {
    _ttsConfigured = value;
  }

  void setPauseWhenCapture(bool value) {
    if (_pauseWhenCapture == value) return;
    _pauseWhenCapture = value;
    if (value) {
      _stopActivePlayback();
    } else if (_queue.isNotEmpty && !_playing) {
      unawaited(_playNext());
    }
    notifyListeners();
  }

  bool shouldBlockMicCapture() {
    return _playing ||
        _queue.isNotEmpty ||
        DateTime.now().millisecondsSinceEpoch < _micBlockUntil;
  }

  void _setPlaybackHold(bool hold) {
    if (_playbackHold == hold) return;
    _playbackHold = hold;
    onPlaybackHoldChange?.call(hold);
  }

  void _syncPlaybackHold() {
    _setPlaybackHold(_playing || _queue.isNotEmpty);
  }

  Future<bool> unlockAudio() async {
    if (_unlocked) return true;
    // Native desktop has no browser autoplay gate — data: URIs also fail on
    // just_audio_media_kit/Windows, which blocked all TTS until "unlock" passed.
    if (!kIsWeb) {
      _unlocked = true;
      playError = null;
      notifyListeners();
      return true;
    }
    try {
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/liminal_audio_unlock.wav');
      if (!await file.exists()) {
        await file.writeAsBytes(_silentWavBytes, flush: true);
      }
      await _player.setAudioSource(AudioSource.file(file.path));
      await _waitUntilReady();
      await _player.play();
      await _player.stop();
      _unlocked = true;
      playError = null;
      notifyListeners();
      return true;
    } catch (e) {
      playError = 'Audio unlock failed — click Send or mic once.';
      notifyListeners();
      return false;
    }
  }

  static final _silentWavBytes = Uint8List.fromList([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x44, 0xac, 0x00, 0x00, 0x88, 0x58, 0x01, 0x00, 0x02, 0x00, 0x10, 0x00,
    0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
  ]);

  void enqueue(SpeechQueueItem item) {
    _queue.add(item);
    queueLength = _queue.length;
    _syncPlaybackHold();
    notifyListeners();
    if (!_pauseWhenCapture && !_playing) {
      unawaited(unlockAudio().then((_) {
        if (!_pauseWhenCapture) unawaited(_playNext());
      }));
    }
  }

  void interrupt() {
    _queue.clear();
    queueLength = 0;
    _stopActivePlayback();
    _syncPlaybackHold();
    notifyListeners();
  }

  void flush() {
    interrupt();
  }

  void _stopActivePlayback() {
    _playGen++;
    _playing = false;
    isSpeaking = false;
    unawaited(_player.stop());
    _syncPlaybackHold();
    notifyListeners();
  }

  Future<void> _playNext() async {
    if (_pauseWhenCapture) {
      _playing = false;
      isSpeaking = false;
      _syncPlaybackHold();
      notifyListeners();
      return;
    }
    if (_queue.isEmpty) {
      _playing = false;
      isSpeaking = false;
      _syncPlaybackHold();
      notifyListeners();
      return;
    }
    final gen = _playGen;
    final item = _queue.removeAt(0);
    queueLength = _queue.length;
    _playing = true;
    isSpeaking = true;
    lastSpoken = item.text;
    playError = null;
    _syncPlaybackHold();
    notifyListeners();
    try {
      await _loadAndPlayClip(item, gen);
      if (gen != _playGen) return;
      await _player.processingStateStream.firstWhere(
        (s) => s == ProcessingState.completed,
      );
      if (gen != _playGen) return;
    } catch (e) {
      if (gen == _playGen) {
        playError = e is HttpException ? e.message : e.toString();
      }
    } finally {
      if (gen == _playGen) {
        _playing = false;
        isSpeaking = false;
        _micBlockUntil =
            DateTime.now().millisecondsSinceEpoch + micBlockAfterTtsMs;
        _syncPlaybackHold();
        notifyListeners();
        if (_queue.isNotEmpty && !_pauseWhenCapture) {
          unawaited(_playNext());
        }
      }
    }
  }

  Future<void> _waitUntilReady() async {
    if (_player.processingState == ProcessingState.ready) return;
    await _player.processingStateStream.firstWhere(
      (s) => s == ProcessingState.ready || s == ProcessingState.completed,
    );
  }

  Future<void> _loadAndPlayClip(SpeechQueueItem item, int gen) async {
    final fetcher = _clipFetcher;
    if (fetcher != null) {
      final clip = await fetcher(item.audioUrl);
      if (gen != _playGen) return;
      if (clip.bytes.isEmpty) {
        throw const HttpException('TTS clip is empty');
      }
      final ext = _extForMime(clip.mimeType);
      final dir = await getTemporaryDirectory();
      final safeId = item.clipId.replaceAll(RegExp(r'[^a-f0-9]'), '');
      final file = File('${dir.path}/liminal_tts_$safeId.$ext');
      await file.writeAsBytes(clip.bytes, flush: true);
      if (gen != _playGen) return;
      await _player.setAudioSource(AudioSource.file(file.path));
    } else {
      await _player.setUrl(item.audioUrl);
    }
    if (gen != _playGen) return;
    await _waitUntilReady();
    final duration = _player.duration;
    if (duration == null || duration <= Duration.zero) {
      throw const HttpException('TTS clip has zero duration');
    }
    await _player.play();
  }

  String _extForMime(String mimeType) {
    final m = mimeType.toLowerCase();
    if (m.contains('mpeg') || m.contains('mp3')) return 'mp3';
    if (m.contains('wav')) return 'wav';
    if (m.contains('ogg')) return 'ogg';
    if (m.contains('flac')) return 'flac';
    return 'bin';
  }

  @override
  void dispose() {
    unawaited(_player.dispose());
    super.dispose();
  }
}

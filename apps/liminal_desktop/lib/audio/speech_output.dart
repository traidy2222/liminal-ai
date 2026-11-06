import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';

import 'tts_clip.dart';
import 'voice_timing.dart';
import 'wav_pcm.dart';

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
  SpeechOutput({AudioPlayer? player, bool? gapless}) : _player = player ?? AudioPlayer(), _canNativeWarm = player == null && !kIsWeb, _gapless = gapless ?? (player == null && !kIsWeb) {
    unawaited(_player.setVolume(1));
  }

  static const micBlockAfterTtsMs = 1200;

  final AudioPlayer _player;
  final bool _canNativeWarm;
  final bool _gapless;
  Future<bool>? _nativeWarmTask;
  ConcatenatingAudioSource? _playlist;
  final List<SpeechQueueItem> _playlistItems = [];
  final Map<String, Future<AudioSource>> _prepared = {};
  Future<void> _appendChain = Future.value();
  final List<SpeechQueueItem> _queue = [];
  bool _playing = false;
  bool _unlocked = false;
  bool _pauseWhenCapture = false;
  bool _playbackHold = false;
  int _micBlockUntil = 0;
  int _playGen = 0;
  void Function()? _cancelPlaybackWait;
  TtsClipFetcher? _clipFetcher;

  String? lastSpoken;
  String? playError;
  bool isSpeaking = false;
  int queueLength = 0;

  bool get ttsConfigured => _ttsConfigured;
  bool _ttsConfigured = false;

  /// True while TTS is playing or clips are queued — pause mic capture (Windows).
  void Function(bool hold)? onPlaybackHoldChange;

  /// Fired when post-playback mic cooldown ends — dictation can re-arm VAD.
  void Function()? onMicCaptureUnblocked;
  /// Cancel not-yet-delivered server chunks as well as local playback.
  void Function()? onInterrupted;

  void setClipFetcher(TtsClipFetcher? fetcher) {
    _clipFetcher = fetcher;
  }

  void setTtsConfigured(bool value) {
    _ttsConfigured = value;
    if (value && _canNativeWarm) unawaited(unlockAudio());
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

  /// Block speech onset while audio is playing or during the short echo tail.
  /// Queued (not yet playing) clips do not block — avoids stuck dictation when
  /// the queue cannot drain while transcribing.
  bool shouldBlockMicCapture() {
    return _playing ||
        DateTime.now().millisecondsSinceEpoch < _micBlockUntil;
  }

  /// True only while a clip is actively playing (used to heal mic suspend).
  bool get isTtsPipelineActive => _playing;

  void _setPlaybackHold(bool hold) {
    if (_playbackHold == hold) return;
    _playbackHold = hold;
    onPlaybackHoldChange?.call(hold);
  }

  void _syncPlaybackHold() {
    // Suspend mic only during actual playback — not for queued clips waiting to play.
    _setPlaybackHold(_playing);
  }

  void _scheduleMicUnblockNotify() {
    final delayMs =
        _micBlockUntil - DateTime.now().millisecondsSinceEpoch;
    if (delayMs <= 0) {
      if (!_playing) onMicCaptureUnblocked?.call();
      return;
    }
    Future.delayed(Duration(milliseconds: delayMs), () {
      if (!_playing) onMicCaptureUnblocked?.call();
    });
  }

  Future<bool> unlockAudio() async {
    if (_unlocked) return true;
    // Native desktop has no browser autoplay gate — data: URIs also fail on
    // just_audio_media_kit/Windows, which blocked all TTS until "unlock" passed.
    if (!kIsWeb) {
      if (_canNativeWarm) return _nativeWarmTask ??= _warmNativeAudio();
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

  Future<bool> _warmNativeAudio() async {
    final generation = _playGen;
    try {
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/liminal_player_warmup.wav');
      await file.writeAsBytes(buildWavFromPcm16(Uint8List(960), sampleRate: 24000));
      if (generation != _playGen) return true;
      await _player.setAudioSource(AudioSource.file(file.path)).timeout(const Duration(seconds: 3));
      await _waitUntilReady();
      if (generation != _playGen) return true;
      unawaited(_player.play().catchError((Object _) {}));
      await Future<void>.delayed(const Duration(milliseconds: 80));
      if (generation == _playGen) await _player.stop();
      voiceTiming('player_warmed');
    } catch (_) {
      // Priming is best effort: real clips retain their normal error handling.
    } finally { _unlocked = true; }
    return true;
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
    if (_playing && _playlist != null) _appendQueued(_playGen);
    if (!_pauseWhenCapture && !_playing) {
      unawaited(unlockAudio().then((_) {
        if (!_pauseWhenCapture && !_playing) unawaited(_playNext());
      }));
    }
  }

  void interrupt() {
    onInterrupted?.call();
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
    _cancelPlaybackWait?.call();
    _playing = false;
    _playlist = null;
    _playlistItems.clear();
    _prepared.clear();
    _appendChain = Future.value();
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
      _micBlockUntil =
          DateTime.now().millisecondsSinceEpoch + micBlockAfterTtsMs;
      _syncPlaybackHold();
      _scheduleMicUnblockNotify();
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
      await _loadClip(item, gen);
      voiceTiming('playback_ready', {'clipId': item.clipId});
      if (gen != _playGen) return;
      await _playUntilCompleted(gen);
      if (gen != _playGen) return;
    } catch (e) {
      if (gen == _playGen) {
        playError = e is HttpException ? e.message : e.toString();
      }
    } finally {
      if (gen == _playGen) {
        _playlist = null;
        _playlistItems.clear();
        if (_queue.isEmpty) _prepared.clear();
        _playing = false;
        isSpeaking = false;
        _micBlockUntil =
            DateTime.now().millisecondsSinceEpoch + micBlockAfterTtsMs;
        _syncPlaybackHold();
        notifyListeners();
        if (_queue.isNotEmpty && !_pauseWhenCapture) {
          unawaited(_playNext());
        } else if (_queue.isEmpty) {
          _scheduleMicUnblockNotify();
        }
      }
    }
  }

  Future<void> _waitUntilReady() async {
    if (_player.processingState == ProcessingState.ready) return;
    await _player.processingStateStream
        .where((s) => s == ProcessingState.ready || s == ProcessingState.completed)
        .timeout(const Duration(seconds: 15)).first;
  }

  /// Windows/media_kit can miss `completed`; a hung wait leaves `_playing` true and
  /// dictation suspended forever while the UI still shows "listening".
  Future<void> _playUntilCompleted(int gen) async {
    final duration = _player.duration;
    final maxWait = duration != null && duration > Duration.zero
        ? duration + const Duration(milliseconds: 750)
        : const Duration(seconds: 90);
    final completed = Completer<void>();
    void cancel() { if (!completed.isCompleted) completed.complete(); }
    _cancelPlaybackWait = cancel;
    void timeout() {
      if (!completed.isCompleted) {
        completed.completeError(TimeoutException('Speech playback timed out.'));
      }
    }
    var deadline = Timer(maxWait, timeout);
    StreamSubscription<ProcessingState>? subscription;
    StreamSubscription<Duration>? positionSubscription;
    StreamSubscription<int?>? indexSubscription;
    StreamSubscription<Duration?>? durationSubscription;
    try {
      if (_gapless) {
        void rearm() {
          deadline.cancel();
          final remaining = (_player.duration ?? const Duration(seconds: 90)) - _player.position;
          deadline = Timer((remaining > Duration.zero ? remaining : Duration.zero) + const Duration(milliseconds: 750), timeout);
        }
        indexSubscription = _player.currentIndexStream.listen((index) {
          rearm();
          if (index != null && index >= 0 && index < _playlistItems.length) {
            lastSpoken = _playlistItems[index].text;
            voiceTiming('playback_segment', {'clipId': _playlistItems[index].clipId, 'index': index});
            notifyListeners();
          }
        });
        durationSubscription = _player.durationStream.listen((_) => rearm());
      }
      // Subscribe before play: media-kit can return after startup, whereas other
      // backends return at completion. Neither may release the hold too early.
      subscription = _player.processingStateStream.listen((state) {
        if (state == ProcessingState.completed && !completed.isCompleted) completed.complete();
      }, onError: (Object error, StackTrace stack) {
        if (!completed.isCompleted) completed.completeError(error, stack);
      });
      if (voiceTimingEnabled) {
        var reported = false;
        positionSubscription = _player.positionStream.listen((position) {
          if (!reported && position > Duration.zero && gen == _playGen) {
            reported = true;
            voiceTiming('playback_started', {'positionMs': position.inMilliseconds});
          }
        });
      }
      voiceTiming('play_requested');
      unawaited(Future<void>.sync(_player.play).catchError((Object error, StackTrace stack) {
        if (!completed.isCompleted) completed.completeError(error, stack);
      }));
      await completed.future;
    } finally {
      deadline.cancel();
      unawaited(positionSubscription?.cancel());
      unawaited(indexSubscription?.cancel());
      unawaited(durationSubscription?.cancel());
      if (identical(_cancelPlaybackWait, cancel)) _cancelPlaybackWait = null;
      // Detach immediately; asynchronous stream cleanup must not gate the mic.
      final cleanup = subscription?.cancel();
      if (cleanup != null) unawaited(cleanup.catchError((Object _) {}));
      // just_audio keeps playing=true after natural completion. Stop before the
      // next source is loaded so its play() cannot return early or auto-start.
      if (gen == _playGen) {
        await _player.stop().timeout(const Duration(seconds: 3));
      }
    }
  }

  Future<void> _loadClip(SpeechQueueItem item, int gen) async {
    final source = await _prepareClip(item);
    if (gen != _playGen) return;
    if (_gapless) {
      final playlist = ConcatenatingAudioSource(useLazyPreparation: false, children: [source]);
      _playlist = playlist;
      _playlistItems.add(item);
      await _player.setAudioSource(playlist).timeout(const Duration(seconds: 20));
      _appendQueued(gen);
    } else {
      await _player.setAudioSource(source).timeout(const Duration(seconds: 20));
    }
    if (gen != _playGen) return;
    await _waitUntilReady();
    final duration = _player.duration;
    if (duration == null || duration <= Duration.zero) throw const HttpException('TTS clip has zero duration');
  }

  void _appendQueued(int gen) {
    final playlist = _playlist;
    if (playlist == null) return;
    _appendChain = _appendChain.catchError((Object _) {}).then((_) async {
      while (gen == _playGen && identical(playlist, _playlist) && _queue.isNotEmpty) {
        final item = _queue.first;
        try {
          final source = await _prepareClip(item);
          if (gen != _playGen || !identical(playlist, _playlist) || _player.processingState == ProcessingState.completed) return;
          await playlist.add(source);
          if (gen != _playGen) return;
          _playlistItems.add(item);
        } catch (error) {
          if (gen != _playGen) return;
          playError = error.toString();
        }
        if (_queue.isNotEmpty && identical(_queue.first, item)) _queue.removeAt(0);
        queueLength = _queue.length;
        notifyListeners();
      }
    });
  }

  Future<AudioSource> _prepareClip(SpeechQueueItem item) =>
      _prepared.putIfAbsent(item.clipId, () => _prepareClipBytes(item));

  Future<AudioSource> _prepareClipBytes(SpeechQueueItem item) async {
    final fetcher = _clipFetcher;
    if (fetcher != null) {
      final clip = await fetcher(item.audioUrl).timeout(const Duration(seconds: 30));
      if (clip.bytes.isEmpty) {
        throw const HttpException('TTS clip is empty');
      }
      final ext = _extForMime(clip.mimeType);
      final dir = await getTemporaryDirectory();
      final safeId = item.clipId.replaceAll(RegExp(r'[^a-f0-9]'), '');
      final file = File('${dir.path}/liminal_tts_$safeId.$ext');
      await file.writeAsBytes(clip.bytes);
      return AudioSource.file(file.path);
    } else {
      return AudioSource.uri(Uri.parse(item.audioUrl));
    }
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
    _playGen++;
    _cancelPlaybackWait?.call();
    unawaited(_player.dispose());
    super.dispose();
  }
}

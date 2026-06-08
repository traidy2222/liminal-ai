import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:mime/mime.dart';

import '../../audio/composer_dictation.dart';
import '../../audio/dictation_controller.dart';
import '../../audio/speech_output.dart';
import '../../models/app_config.dart';
import '../../models/user_image_attachment.dart';
import '../theme/liminal_theme_extension.dart';

typedef ComposerSendCallback = void Function(
  String text,
  List<UserImageAttachment> attachments,
);

class Composer extends StatefulWidget {
  const Composer({
    super.key,
    required this.enabled,
    required this.busy,
    required this.onSend,
    required this.onAbort,
    this.config,
    this.dictation,
    this.speechOutput,
    this.onDictationAutoSend,
    this.dictationNotice,
    this.onDismissDictationNotice,
  });

  final bool enabled;
  final bool busy;
  final ComposerSendCallback onSend;
  final VoidCallback onAbort;
  final AppConfig? config;
  final DictationController? dictation;
  final SpeechOutput? speechOutput;
  final Future<String?> Function(String fullMessage)? onDictationAutoSend;
  final String? dictationNotice;
  final VoidCallback? onDismissDictationNotice;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  final _controller = TextEditingController();
  final _attachments = <UserImageAttachment>[];
  late final ComposerDictationSpan _dictationSpan;
  String? _attachError;
  String? _localDictationNotice;

  static const _maxCount = 4;
  static const _maxBytesPerImage = 4 * 1024 * 1024;
  static const _maxTotalBytes = 12 * 1024 * 1024;

  @override
  void initState() {
    super.initState();
    _dictationSpan = ComposerDictationSpan(_controller);
    _wireDictation();
    widget.dictation?.addListener(_onDictationChanged);
  }

  @override
  void didUpdateWidget(covariant Composer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.dictation != widget.dictation) {
      oldWidget.dictation?.removeListener(_onDictationChanged);
      widget.dictation?.addListener(_onDictationChanged);
      _wireDictation();
    }
  }

  void _wireDictation() {
    final d = widget.dictation;
    if (d == null) return;
    d.onInterim = (text) {
      if (!d.sessionActive) return;
      _dictationSpan.setInterim(text);
      setState(() {});
    };
    d.onRefined = (text, {required bool wasAutoSent}) {
      if (!wasAutoSent) {
        _dictationSpan.replaceWithRefined(text);
        setState(() {});
      }
    };
    d.onAutoSend = (text) async {
      final refined = text.trim();
      if (refined.isNotEmpty) {
        _dictationSpan.replaceWithRefined(refined);
      }
      final full = _dictationSpan.buildFullMessageForAutoSend();
      final message = full.isNotEmpty ? full : refined;
      if (message.isEmpty) {
        setState(() => _localDictationNotice = 'Empty transcript — nothing to send.');
        return;
      }
      final err = await widget.onDictationAutoSend?.call(message);
      if (!mounted) return;
      if (err == 'queued') {
        setState(() => _localDictationNotice = widget.dictationNotice);
        return;
      }
      if (err != null) {
        setState(() => _localDictationNotice = err);
        return;
      }
      _controller.clear();
      _dictationSpan.clearAfterSend();
      _dictationSpan.onStart();
      setState(() {
        _localDictationNotice = null;
        _attachError = null;
      });
    };
  }

  void _onDictationChanged() => setState(() {});

  Future<void> _toggleDictation() async {
    final d = widget.dictation;
    if (d == null || !widget.enabled) return;
    unawaited(widget.speechOutput?.unlockAudio());
    if (d.sessionActive) {
      await d.endSession();
    } else {
      _dictationSpan.onStart();
      await d.startSession();
    }
  }

  Future<void> _pickImages() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      allowMultiple: true,
      withData: true,
    );
    if (result == null) return;
    setState(() => _attachError = null);
    for (final f in result.files) {
      final bytes = f.bytes;
      if (bytes == null || bytes.isEmpty) continue;
      final mime = lookupMimeType(f.name, headerBytes: bytes) ?? 'image/png';
      if (!mime.startsWith('image/')) continue;
      _tryAdd(
        UserImageAttachment(
          name: f.name,
          mimeType: mime,
          bytes: bytes,
          source: 'path',
        ),
      );
    }
    setState(() {});
  }

  void _tryAdd(UserImageAttachment item) {
    if (_attachments.length >= _maxCount) {
      _attachError = 'Max $_maxCount images.';
      return;
    }
    if (item.sizeBytes > _maxBytesPerImage) {
      _attachError = 'Image too large (max ${(_maxBytesPerImage / (1024 * 1024)).round()} MB).';
      return;
    }
    var total = item.sizeBytes;
    for (final a in _attachments) {
      total += a.sizeBytes;
    }
    if (total > _maxTotalBytes) {
      _attachError = 'Total attachment size exceeded.';
      return;
    }
    _attachments.add(item);
  }

  void _submit() {
    final text = _controller.text;
    if (text.trim().isEmpty && _attachments.isEmpty) return;
    widget.onSend(text.trim(), List.unmodifiable(_attachments));
    _controller.clear();
    setState(() {
      _attachments.clear();
      _attachError = null;
    });
  }

  @override
  void dispose() {
    widget.dictation?.removeListener(_onDictationChanged);
    _controller.dispose();
    super.dispose();
  }

  String? get _notice =>
      widget.dictationNotice ?? _localDictationNotice;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final d = widget.dictation;
    final speech = widget.speechOutput;
    final sessionActive = d?.sessionActive ?? false;
    final showTtsBanner =
        sessionActive && widget.config?.ttsEnabled != true;

    return SafeArea(
        child: Container(
          decoration: BoxDecoration(
            color: lim.panel.withValues(alpha: 0.94),
            border: Border(top: BorderSide(color: lim.border)),
          ),
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (showTtsBanner)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    'Spoken replies are off — enable AGENT_TTS_ENABLED in Settings.',
                    style: TextStyle(color: lim.warn, fontSize: 12),
                  ),
                ),
              if (speech?.isSpeaking == true)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    'Speaking: ${speech?.lastSpoken ?? ''}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: lim.accent, fontSize: 12),
                  ),
                ),
              if (speech?.playError != null && speech!.playError!.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    speech.playError!,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: lim.warn, fontSize: 12),
                  ),
                ),
              if (d != null && sessionActive && d.status != DictationStatus.idle)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    children: [
                      Icon(
                        d.status == DictationStatus.recording
                            ? Icons.fiber_manual_record
                            : Icons.hearing,
                        size: 14,
                        color: lim.accent,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          _dictationStatusLabel(d),
                          style: TextStyle(color: lim.textMuted, fontSize: 12),
                        ),
                      ),
                      if (d.autoSendCountdownMs != null)
                        Text(
                          'Sending in ${((d.autoSendCountdownMs! / 1000).ceil())}s',
                          style: TextStyle(color: lim.warn, fontSize: 12),
                        ),
                    ],
                  ),
                ),
              if (_notice != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          _notice!,
                          style: TextStyle(color: lim.warn, fontSize: 12),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close, size: 16),
                        onPressed: () {
                          setState(() => _localDictationNotice = null);
                          widget.onDismissDictationNotice?.call();
                        },
                      ),
                    ],
                  ),
                ),
              if (_attachError != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    _attachError!,
                    style: TextStyle(color: lim.danger, fontSize: 12),
                  ),
                ),
              if (_attachments.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (var i = 0; i < _attachments.length; i++)
                        InputChip(
                          label: Text(
                            _attachments[i].name,
                            style: const TextStyle(fontSize: 11),
                          ),
                          onDeleted: widget.enabled
                              ? () => setState(() => _attachments.removeAt(i))
                              : null,
                        ),
                    ],
                  ),
                ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  if (d != null)
                    IconButton(
                      tooltip: sessionActive ? 'Stop voice session' : 'Start voice session',
                      onPressed: widget.enabled ? _toggleDictation : null,
                      icon: Icon(
                        sessionActive ? Icons.mic : Icons.mic_none_outlined,
                        color: sessionActive ? lim.accent : lim.textMuted,
                      ),
                    ),
                  IconButton(
                    tooltip: 'Attach images',
                    onPressed: widget.enabled && !widget.busy ? _pickImages : null,
                    icon: Icon(Icons.image_outlined, color: lim.textMuted),
                  ),
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      enabled: widget.enabled,
                      minLines: 1,
                      maxLines: 6,
                      style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: lim.text),
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _submit(),
                      decoration: InputDecoration(
                        hintText: sessionActive
                            ? 'Voice session on — speak or type…'
                            : (widget.config?.resolvedCopy.composerPlaceholder ??
                                'Message ${lim.displayLabel}…'),
                        filled: true,
                        fillColor: lim.surface.withValues(alpha: 0.55),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  if (d != null && d.status == DictationStatus.recording)
                    IconButton(
                      tooltip: 'Send now',
                      onPressed: () => unawaited(d.forceSend()),
                      icon: Icon(Icons.stop, color: lim.accent),
                    )
                  else if (widget.busy)
                    IconButton(
                      tooltip: widget.config?.resolvedCopy.stopLabel ?? 'Stop turn',
                      onPressed: widget.onAbort,
                      icon: Icon(Icons.stop_circle, color: lim.danger),
                    )
                  else
                    FilledButton(
                      onPressed: widget.enabled ? _submit : null,
                      style: FilledButton.styleFrom(
                        minimumSize: const Size(48, 48),
                        padding: EdgeInsets.zero,
                      ),
                      child: Tooltip(
                        message: widget.config?.resolvedCopy.sendLabel ?? 'Send',
                        child: const Icon(Icons.send),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
    );
  }

  String _dictationStatusLabel(DictationController d) {
    switch (d.status) {
      case DictationStatus.listening:
        return 'Listening…';
      case DictationStatus.paused:
        return 'Paused (agent speaking)…';
      case DictationStatus.recording:
        return 'Recording…';
      case DictationStatus.uploading:
        return 'Uploading audio…';
      case DictationStatus.transcribing:
        return 'Transcribing…';
      case DictationStatus.permissionPending:
        return 'Requesting microphone…';
      case DictationStatus.error:
        return d.error ?? 'Dictation error';
      case DictationStatus.idle:
        return '';
    }
  }
}

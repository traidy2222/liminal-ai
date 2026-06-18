import 'dart:async';
import 'dart:io';

import 'package:desktop_drop/desktop_drop.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mime/mime.dart';

import '../../audio/composer_dictation.dart';
import '../../audio/dictation_controller.dart';
import '../../audio/speech_output.dart';
import '../../models/app_config.dart';
import '../../models/composer_slash_outcome.dart';
import '../../models/context_snapshot.dart';
import '../../models/user_image_attachment.dart';
import '../design_system/liminal_design_system.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import 'composer_clipboard.dart';
import 'composer_slash.dart';
import 'composer_slash_menu.dart';
import 'context_meter.dart';

typedef ComposerSendCallback = void Function(
  String text,
  List<UserImageAttachment> attachments, {
  String? workflowPreset,
});

typedef ComposerSlashCallback = Future<ComposerSlashOutcome> Function(
  ParsedComposerSlash parsed,
  int attachmentCount,
);

class Composer extends StatefulWidget {
  const Composer({
    super.key,
    required this.enabled,
    required this.busy,
    required this.onSend,
    required this.onAbort,
    this.onSlash,
    this.config,
    this.dictation,
    this.speechOutput,
    this.onDictationAutoSend,
    this.dictationNotice,
    this.onDismissDictationNotice,
    this.contextSnapshot,
  });

  final bool enabled;
  final bool busy;
  final ComposerSendCallback onSend;
  final VoidCallback onAbort;
  final ComposerSlashCallback? onSlash;
  final AppConfig? config;
  final DictationController? dictation;
  final SpeechOutput? speechOutput;
  final Future<String?> Function(String fullMessage)? onDictationAutoSend;
  final String? dictationNotice;
  final VoidCallback? onDismissDictationNotice;
  final ContextSnapshot? contextSnapshot;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  final _attachments = <UserImageAttachment>[];
  late final ComposerDictationSpan _dictationSpan;
  String? _attachError;
  String? _slashNotice;
  String? _localDictationNotice;
  List<SlashCompletionItem> _slashItems = const [];
  int _slashSelected = 0;
  bool _slashMenuOpen = true;

  bool _dragOver = false;

  static const _maxCount = 12;
  static const _maxImageBytes = 4 * 1024 * 1024;
  static const _maxFileBytes = 25 * 1024 * 1024;
  static const _maxTotalBytes = 64 * 1024 * 1024;

  @override
  void initState() {
    super.initState();
    _dictationSpan = ComposerDictationSpan(_controller);
    _controller.addListener(_refreshSlashCompletions);
    _wireDictation();
    widget.dictation?.addListener(_onDictationChanged);
    HardwareKeyboard.instance.addHandler(_onKeyEvent);
  }

  void _refreshSlashCompletions() {
    final cursor = _controller.selection.baseOffset.clamp(0, _controller.text.length);
    final items = listSlashCompletions(_controller.text, cursor);
    if (!mounted) return;
    setState(() {
      _slashItems = items;
      if (_slashSelected >= items.length) _slashSelected = 0;
    });
  }

  void _applySlashPick(SlashCompletionItem item) {
    final cursor = _controller.selection.baseOffset.clamp(0, _controller.text.length);
    final next = applySlashCompletion(_controller.text, cursor, item);
    _controller.value = _controller.value.copyWith(
      text: next.text,
      selection: TextSelection.collapsed(offset: next.cursor),
      composing: TextRange.empty,
    );
    setState(() => _slashMenuOpen = true);
  }

  KeyEventResult _onComposerKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    if (!_slashMenuOpen || _slashItems.isEmpty) return KeyEventResult.ignored;

    if (event.logicalKey == LogicalKeyboardKey.escape) {
      setState(() => _slashMenuOpen = false);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowDown) {
      setState(() => _slashSelected = (_slashSelected + 1).clamp(0, _slashItems.length - 1));
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowUp) {
      setState(() => _slashSelected = (_slashSelected - 1).clamp(0, _slashItems.length - 1));
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.tab) {
      _applySlashPick(_slashItems[_slashSelected]);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
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

  Future<void> _pickFiles() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.any,
      allowMultiple: true,
      withData: true,
    );
    if (result == null) return;
    setState(() => _attachError = null);
    for (final f in result.files) {
      final bytes = f.bytes;
      if (bytes == null || bytes.isEmpty) continue;
      final mime = lookupMimeType(f.name, headerBytes: bytes) ?? 'application/octet-stream';
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

  Future<void> _onDragDone(DropDoneDetails details) async {
    if (!widget.enabled || widget.busy) return;
    setState(() {
      _dragOver = false;
      _attachError = null;
    });
    for (final xfile in details.files) {
      final bytes = await xfile.readAsBytes();
      if (bytes.isEmpty) continue;
      final name = xfile.name;
      final mime = lookupMimeType(name, headerBytes: bytes) ?? 'application/octet-stream';
      _tryAdd(
        UserImageAttachment(
          name: name,
          mimeType: mime,
          bytes: bytes,
          source: 'drop',
        ),
      );
    }
    if (mounted) setState(() {});
  }

  Future<void> _pickImages() async => _pickFiles();

  Future<void> _handlePaste() async {
    if (!widget.enabled || widget.busy) return;

    final imageBytes = await ComposerClipboard.readImageBytes();
    if (imageBytes != null) {
      setState(() => _attachError = null);
      _tryAdd(ComposerClipboard.attachmentFromClipboardBytes(imageBytes));
      setState(() {});
      return;
    }

    final paths = await ComposerClipboard.readImageFilePaths();
    if (paths.isNotEmpty) {
      setState(() => _attachError = null);
      for (final item in await ComposerClipboard.attachmentsFromPaths(paths)) {
        _tryAdd(item);
      }
      setState(() {});
      return;
    }

    final text = await ComposerClipboard.readPlainText();
    if (text == null) return;
    _insertTextAtSelection(text);
    setState(() {});
  }

  void _insertTextAtSelection(String text) {
    final value = _controller.value;
    final selection = value.selection;
    final start = selection.isValid ? selection.start : value.text.length;
    final end = selection.isValid ? selection.end : value.text.length;
    final newText = value.text.replaceRange(start, end, text);
    final offset = start + text.length;
    _controller.value = value.copyWith(
      text: newText,
      selection: TextSelection.collapsed(offset: offset),
      composing: TextRange.empty,
    );
  }

  bool _onKeyEvent(KeyEvent event) {
    if (!_focusNode.hasFocus || !widget.enabled) return false;
    if (event is! KeyDownEvent) return false;
    if (event.logicalKey != LogicalKeyboardKey.keyV) return false;
    final hw = HardwareKeyboard.instance;
    if (!hw.isControlPressed && !hw.isMetaPressed) return false;
    unawaited(_handlePaste());
    return true;
  }

  void _tryAdd(UserImageAttachment item) {
    if (_attachments.length >= _maxCount) {
      _attachError = 'Max $_maxCount attachments.';
      return;
    }
    final maxOne = item.isImage ? _maxImageBytes : _maxFileBytes;
    if (item.sizeBytes > maxOne) {
      _attachError =
          '${item.name} is too large (max ${(maxOne / (1024 * 1024)).round()} MB).';
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

  Future<void> _attachFromPath(String path) async {
    final file = File(path);
    if (!await file.exists()) {
      setState(() => _attachError = 'File not found: $path');
      return;
    }
    final bytes = await file.readAsBytes();
    if (bytes.isEmpty) {
      setState(() => _attachError = 'Image file is empty.');
      return;
    }
    final name = path.split(RegExp(r'[\\/]')).last;
    final mime = lookupMimeType(name, headerBytes: bytes) ?? 'application/octet-stream';
    _tryAdd(UserImageAttachment(
      name: name,
      mimeType: mime,
      bytes: bytes,
      source: 'path',
    ));
    setState(() => _attachError = null);
  }

  Future<void> _submit({String? workflowPreset}) async {
    final text = _controller.text;
    if (text.trim().isEmpty && _attachments.isEmpty) return;
    if (workflowPreset == 'receipt_to_xero' &&
        !_attachments.any((a) => a.isImage)) {
      setState(() => _attachError = 'Attach a receipt image first.');
      return;
    }

    final parsed = workflowPreset == null ? parseComposerSlashSubmit(text) : null;
    if (parsed != null && widget.onSlash != null) {
      final outcome = await widget.onSlash!(parsed, _attachments.length);
      if (outcome.handled) {
        if (outcome.attachPath != null) {
          await _attachFromPath(outcome.attachPath!);
        }
        if (outcome.abortTurn) {
          widget.onAbort();
        }
        if (outcome.message != null) {
          setState(() {
            _slashNotice = outcome.message;
            _attachError = null;
          });
        }
        if (outcome.sendText != null) {
          widget.onSend(
            outcome.sendText!,
            List.unmodifiable(_attachments),
            workflowPreset: outcome.workflowPreset,
          );
        }
        if (outcome.clearInput) {
          _controller.clear();
          setState(() {
            if (outcome.sendText != null) _attachments.clear();
            _slashMenuOpen = true;
          });
        }
        return;
      }
    }

    widget.onSend(
      text.trim(),
      List.unmodifiable(_attachments),
      workflowPreset: workflowPreset,
    );
    _controller.clear();
    setState(() {
      _attachments.clear();
      _attachError = null;
      _slashNotice = null;
    });
  }

  void _submitReceipts() => unawaited(_submit(workflowPreset: 'receipt_to_xero'));

  @override
  void dispose() {
    _controller.removeListener(_refreshSlashCompletions);
    HardwareKeyboard.instance.removeHandler(_onKeyEvent);
    widget.dictation?.removeListener(_onDictationChanged);
    _focusNode.dispose();
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

    return DropTarget(
      onDragEntered: (_) {
        if (!widget.enabled || widget.busy) return;
        setState(() => _dragOver = true);
      },
      onDragExited: (_) => setState(() => _dragOver = false),
      onDragDone: _onDragDone,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 120),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: _dragOver
              ? Border.all(color: lim.accent.withValues(alpha: 0.55), width: 1.5)
              : null,
        ),
        child: SafeArea(
        child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.contextSnapshot != null)
                ContextMeter(snapshot: widget.contextSnapshot!),
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
              if (_slashNotice != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    _slashNotice!,
                    style: TextStyle(color: lim.accent, fontSize: 12),
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
                  padding: const EdgeInsets.only(bottom: LiminalSpacing.xs),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          for (var i = 0; i < _attachments.length; i++)
                            InputChip(
                              avatar: Icon(
                                _attachments[i].isImage
                                    ? Icons.image_outlined
                                    : Icons.attach_file,
                                size: 16,
                                color: lim.textMuted,
                              ),
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
                      const SizedBox(height: 6),
                      TextButton.icon(
                        onPressed: widget.enabled && !widget.busy ? _submitReceipts : null,
                        icon: const Icon(Icons.receipt_long_outlined, size: 16),
                        label: const Text('Process receipts'),
                      ),
                    ],
                  ),
                ),
              if (_slashMenuOpen && _slashItems.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: ComposerSlashMenu(
                    items: _slashItems,
                    selectedIndex: _slashSelected,
                    onPick: _applySlashPick,
                  ),
                ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  if (d != null)
                    LiminalIconButton(
                      icon: sessionActive ? Icons.mic : Icons.mic_none_outlined,
                      tooltip: sessionActive ? 'Stop voice session' : 'Start voice session',
                      onPressed: widget.enabled ? _toggleDictation : null,
                      selected: sessionActive,
                    ),
                  LiminalIconButton(
                    icon: Icons.attach_file_outlined,
                    tooltip: 'Attach files (drag & drop, or Ctrl+V / Cmd+V paste)',
                    onPressed: widget.enabled && !widget.busy ? _pickFiles : null,
                  ),
                  Expanded(
                    child: Focus(
                      onKeyEvent: _onComposerKey,
                      child: TextField(
                      controller: _controller,
                      focusNode: _focusNode,
                      enabled: widget.enabled,
                      minLines: 1,
                      maxLines: 6,
                      style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: lim.text),
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => unawaited(_submit()),
                      contextMenuBuilder: (context, editableTextState) {
                        return AdaptiveTextSelectionToolbar.buttonItems(
                          anchors: editableTextState.contextMenuAnchors,
                          buttonItems: <ContextMenuButtonItem>[
                            ContextMenuButtonItem(
                              onPressed: () {
                                ContextMenuController.removeAny();
                                editableTextState.cutSelection(SelectionChangedCause.toolbar);
                              },
                              type: ContextMenuButtonType.cut,
                            ),
                            ContextMenuButtonItem(
                              onPressed: () {
                                ContextMenuController.removeAny();
                                editableTextState.copySelection(SelectionChangedCause.toolbar);
                              },
                              type: ContextMenuButtonType.copy,
                            ),
                            ContextMenuButtonItem(
                              onPressed: () {
                                ContextMenuController.removeAny();
                                unawaited(_handlePaste());
                              },
                              type: ContextMenuButtonType.paste,
                            ),
                            ContextMenuButtonItem(
                              onPressed: () {
                                ContextMenuController.removeAny();
                                editableTextState.selectAll(SelectionChangedCause.toolbar);
                              },
                              type: ContextMenuButtonType.selectAll,
                            ),
                          ],
                        );
                      },
                      decoration: InputDecoration(
                        hintText: sessionActive
                            ? 'Voice session on — speak or type…'
                            : (widget.config?.resolvedCopy.composerPlaceholder ??
                                'Message ${lim.displayLabel}…'),
                        filled: true,
                        fillColor: lim.surface.withValues(alpha: 0.55),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: LiminalSpacing.sm,
                          vertical: LiminalSpacing.sm,
                        ),
                      ),
                    ),
                    ),
                  ),
                  const SizedBox(width: LiminalSpacing.xs),
                  if (d != null && d.status == DictationStatus.recording)
                    LiminalIconButton(
                      icon: Icons.send,
                      tooltip: 'Send now',
                      onPressed: () => unawaited(d.forceSend()),
                    )
                  else if (widget.busy)
                    LiminalButton.icon(
                      label: widget.config?.resolvedCopy.stopLabel ?? 'Stop',
                      icon: Icons.stop_circle_outlined,
                      variant: LiminalButtonVariant.danger,
                      dense: true,
                      onPressed: widget.onAbort,
                    )
                  else
                    LiminalButton.icon(
                      label: widget.config?.resolvedCopy.sendLabel ?? 'Send',
                      icon: Icons.send,
                      dense: true,
                      onPressed: widget.enabled ? () => unawaited(_submit()) : null,
                    ),
                ],
              ),
            ],
        ),
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

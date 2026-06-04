import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:mime/mime.dart';

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
  });

  final bool enabled;
  final bool busy;
  final ComposerSendCallback onSend;
  final VoidCallback onAbort;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  final _controller = TextEditingController();
  final _attachments = <UserImageAttachment>[];
  String? _attachError;

  static const _maxCount = 4;
  static const _maxBytesPerImage = 4 * 1024 * 1024;
  static const _maxTotalBytes = 12 * 1024 * 1024;

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
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
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
                      hintText: 'Message ${lim.displayLabel}…',
                      filled: true,
                      fillColor: lim.surface.withValues(alpha: 0.55),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                if (widget.busy)
                  IconButton(
                    tooltip: 'Stop turn',
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
                    child: const Icon(Icons.send),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

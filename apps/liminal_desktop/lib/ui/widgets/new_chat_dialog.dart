import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../protocol/chat_summary.dart';
import '../../state/app_controller.dart';
import '../design_system/liminal_design_system.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';

class NewChatInput {
  const NewChatInput({
    required this.workspaceMode,
    this.workspaceRoot,
    this.title,
  });

  final String workspaceMode;
  final String? workspaceRoot;
  final String? title;
}

/// Desktop new-chat flow — scratch, folder picker, reuse, or default folder.
class NewChatDialog extends StatefulWidget {
  const NewChatDialog({
    super.key,
    required this.host,
    required this.knownChats,
  });

  final AppController host;
  final List<ChatSummary> knownChats;

  static Future<NewChatInput?> show(
    BuildContext context, {
    required AppController host,
    List<ChatSummary> knownChats = const [],
  }) {
    return showDialog<NewChatInput>(
      context: context,
      builder: (ctx) => NewChatDialog(host: host, knownChats: knownChats),
    );
  }

  @override
  State<NewChatDialog> createState() => _NewChatDialogState();
}

class _NewChatDialogState extends State<NewChatDialog> {
  String _mode = 'scratch';
  final _title = TextEditingController();
  String? _folderPath;
  String? _reuseChatId;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final defaultFolder = widget.host.config?.defaultWorkspaceFolder?.trim();
    if (defaultFolder != null && defaultFolder.isNotEmpty) {
      _mode = 'default';
      _folderPath = defaultFolder;
    }
    final reuseCandidates = widget.knownChats
        .where((c) => c.workspaceRoot.trim().isNotEmpty)
        .toList();
    if (reuseCandidates.isNotEmpty) {
      _reuseChatId = reuseCandidates.first.chatId;
    }
  }

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  Future<void> _pickFolder() async {
    final picked = await FilePicker.platform.getDirectoryPath(
      dialogTitle: 'Choose workspace folder',
    );
    if (picked == null || !mounted) return;
    setState(() {
      _folderPath = picked;
      _mode = 'folder';
      _error = null;
    });
  }

  Future<void> _submit() async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final title = _title.text.trim();
      switch (_mode) {
        case 'scratch':
          Navigator.pop(
            context,
            NewChatInput(
              workspaceMode: 'scratch',
              title: title.isEmpty ? null : title,
            ),
          );
        case 'default':
          final path = widget.host.config?.defaultWorkspaceFolder?.trim();
          if (path == null || path.isEmpty) {
            throw StateError('Set a default workspace folder in Settings first.');
          }
          Navigator.pop(
            context,
            NewChatInput(
              workspaceMode: 'folder',
              workspaceRoot: path,
              title: title.isEmpty ? null : title,
            ),
          );
        case 'folder':
          final path = _folderPath?.trim();
          if (path == null || path.isEmpty) {
            throw StateError('Pick a folder for this chat.');
          }
          Navigator.pop(
            context,
            NewChatInput(
              workspaceMode: 'folder',
              workspaceRoot: path,
              title: title.isEmpty ? null : title,
            ),
          );
        case 'reuse':
          final id = _reuseChatId;
          ChatSummary? reuseChat;
          for (final c in widget.knownChats) {
            if (c.chatId == id) {
              reuseChat = c;
              break;
            }
          }
          if (reuseChat == null || reuseChat.workspaceRoot.trim().isEmpty) {
            throw StateError('Pick a chat to reuse its workspace.');
          }
          Navigator.pop(
            context,
            NewChatInput(
              workspaceMode: 'reuse',
              workspaceRoot: reuseChat.workspaceRoot,
              title: title.isEmpty ? null : title,
            ),
          );
        default:
          throw StateError('Unknown workspace mode.');
      }
    } catch (err) {
      setState(() => _error = err.toString().replaceFirst('StateError: ', ''));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final defaultFolder = widget.host.config?.defaultWorkspaceFolder?.trim();
    final hasDefault = defaultFolder != null && defaultFolder.isNotEmpty;
    final reuseCandidates = widget.knownChats
        .where((c) => c.workspaceRoot.trim().isNotEmpty)
        .toList();

    return AlertDialog(
      title: const Text('New chat'),
      content: SizedBox(
        width: 460,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Memories and persona carry across chats. Workspace mode only decides where files land.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: lim.textMuted,
                    height: 1.45,
                  ),
            ),
            const SizedBox(height: LiminalSpacing.md),
            TextField(
              controller: _title,
              enabled: !_submitting,
              decoration: const InputDecoration(
                labelText: 'Title (optional)',
                hintText: 'e.g. Website SEO pass',
              ),
            ),
            const SizedBox(height: LiminalSpacing.md),
            _ModeTile(
              selected: _mode == 'scratch',
              title: 'Scratch workspace',
              subtitle: 'Disposable folder under ~/.liminal/chats/…',
              onTap: _submitting
                  ? null
                  : () => setState(() {
                        _mode = 'scratch';
                        _error = null;
                      }),
            ),
            if (hasDefault)
              _ModeTile(
                selected: _mode == 'default',
                title: 'Default folder',
                subtitle: defaultFolder!,
                onTap: _submitting
                    ? null
                    : () => setState(() {
                          _mode = 'default';
                          _error = null;
                        }),
              ),
            _ModeTile(
              selected: _mode == 'folder',
              title: 'Choose folder…',
              subtitle: _folderPath?.trim().isNotEmpty == true
                  ? _folderPath!
                  : 'Open a project directory on disk',
              onTap: _submitting
                  ? null
                  : () async {
                      await _pickFolder();
                    },
            ),
            if (reuseCandidates.isNotEmpty) ...[
              const SizedBox(height: LiminalSpacing.xs),
              DropdownMenu<String>(
                initialSelection: _reuseChatId,
                label: const Text('Reuse workspace from'),
                dropdownMenuEntries: [
                  for (final c in reuseCandidates)
                    DropdownMenuEntry(
                      value: c.chatId,
                      label: '${c.title} · ${c.workspaceRoot}',
                    ),
                ],
                onSelected: _submitting
                    ? null
                    : (id) {
                        if (id == null) return;
                        setState(() {
                          _mode = 'reuse';
                          _reuseChatId = id;
                          _error = null;
                        });
                      },
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: LiminalSpacing.sm),
              Text(
                _error!,
                style: TextStyle(color: lim.danger, fontSize: 12),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _submitting ? null : () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _submitting ? null : _submit,
          child: _submitting
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Create'),
        ),
      ],
    );
  }
}

class _ModeTile extends StatelessWidget {
  const _ModeTile({
    required this.selected,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final bool selected;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: LiminalSpacing.xs),
      child: Material(
        color: selected
            ? lim.accent.withValues(alpha: 0.08)
            : lim.panel.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(lim.radius),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(lim.radius),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: LiminalSpacing.sm,
              vertical: LiminalSpacing.sm,
            ),
            child: Row(
              children: [
                Icon(
                  selected ? Icons.radio_button_checked : Icons.radio_button_off,
                  size: 18,
                  color: selected ? lim.accent : lim.textMuted,
                ),
                const SizedBox(width: LiminalSpacing.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      Text(
                        subtitle,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: lim.textMuted,
                            ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';

import '../../models/inbox_snapshot.dart';
import '../theme/liminal_theme_extension.dart';

class InboxPanel extends StatefulWidget {
  const InboxPanel({
    super.key,
    required this.snapshot,
    required this.busy,
    required this.onProcess,
    required this.onDismiss,
    required this.onRefresh,
  });

  final InboxSnapshot snapshot;
  final bool busy;
  final Future<void> Function(List<String> itemIds) onProcess;
  final Future<void> Function(List<String> itemIds) onDismiss;
  final Future<void> Function() onRefresh;

  @override
  State<InboxPanel> createState() => _InboxPanelState();
}

class _InboxPanelState extends State<InboxPanel> {
  final Set<String> _selected = {};

  @override
  void didUpdateWidget(covariant InboxPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    final ids = widget.snapshot.pendingItems.map((i) => i.itemId).toSet();
    _selected.removeWhere((id) => !ids.contains(id));
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final items = widget.snapshot.pendingItems;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Inbox',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                IconButton(
                  tooltip: 'Refresh',
                  onPressed: widget.busy ? null : () => widget.onRefresh(),
                  icon: const Icon(Icons.refresh),
                ),
                IconButton(
                  tooltip: 'Close',
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            Text(
              'Triaged from connected Gmail/Outlook accounts. Process sends items to the agent — drafts still require approval.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: lim.textDim),
            ),
            const SizedBox(height: 12),
            if (items.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Text(
                  'No pending inbox items.',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: lim.textDim),
                ),
              )
            else
              Flexible(
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: items.length,
                  itemBuilder: (context, index) {
                    final item = items[index];
                    final selected = _selected.contains(item.itemId);
                    return Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: CheckboxListTile(
                        value: selected,
                        onChanged: (v) {
                          setState(() {
                            if (v == true) {
                              _selected.add(item.itemId);
                            } else {
                              _selected.remove(item.itemId);
                            }
                          });
                        },
                        title: Text(
                          item.subject.isNotEmpty ? item.subject : '(no subject)',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              item.from.isNotEmpty ? item.from : item.fromEmail,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            if (item.verdict.summary.isNotEmpty)
                              Text(
                                item.verdict.summary,
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                      color: item.verdict.needsAction ? lim.accent : lim.textDim,
                                    ),
                              ),
                          ],
                        ),
                        secondary: _CategoryChip(category: item.verdict.category),
                      ),
                    );
                  },
                ),
              ),
            const SizedBox(height: 8),
            Row(
              children: [
                TextButton(
                  onPressed: items.isEmpty
                      ? null
                      : () {
                          setState(() {
                            if (_selected.length == items.length) {
                              _selected.clear();
                            } else {
                              _selected
                                ..clear()
                                ..addAll(items.map((i) => i.itemId));
                            }
                          });
                        },
                  child: Text(_selected.length == items.length ? 'Clear' : 'Select all'),
                ),
                const Spacer(),
                TextButton(
                  onPressed: widget.busy || _selected.isEmpty
                      ? null
                      : () async {
                          await widget.onDismiss(_selected.toList());
                          if (mounted) setState(() => _selected.clear());
                        },
                  child: const Text('Dismiss'),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: widget.busy || _selected.isEmpty
                      ? null
                      : () async {
                          await widget.onProcess(_selected.toList());
                          if (mounted) Navigator.pop(context);
                        },
                  child: widget.busy
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Process'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _CategoryChip extends StatelessWidget {
  const _CategoryChip({required this.category});

  final String category;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final color = switch (category) {
      'urgent' => lim.danger,
      'action' => lim.accent,
      'spam' => lim.textDim,
      _ => lim.textDim,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        border: Border.all(color: color.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        category,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color),
      ),
    );
  }
}

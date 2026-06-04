import 'package:flutter/material.dart';

import '../../state/message_models.dart';
import '../theme/liminal_theme_extension.dart';

class AskUserSheet extends StatefulWidget {
  const AskUserSheet({
    super.key,
    required this.pending,
    required this.onSubmit,
  });

  final PendingAskUser pending;
  final ValueChanged<String> onSubmit;

  @override
  State<AskUserSheet> createState() => _AskUserSheetState();
}

class _AskUserSheetState extends State<AskUserSheet> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: lim.panel.withValues(alpha: 0.98),
        border: Border(top: BorderSide(color: lim.accent.withValues(alpha: 0.5), width: 2)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            widget.pending.prompt,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(color: lim.accent),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _controller,
            autofocus: true,
            minLines: 1,
            maxLines: 4,
            decoration: const InputDecoration(hintText: 'Your answer'),
            onSubmitted: widget.onSubmit,
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: () => widget.onSubmit(_controller.text),
              child: const Text('Submit'),
            ),
          ),
        ],
      ),
    );
  }
}

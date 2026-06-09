import 'package:flutter/material.dart';

import '../../state/message_models.dart';
import '../design_system/liminal_design_system.dart';
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
    return LiminalSheet(
      title: widget.pending.prompt,
      accentColor: lim.accent,
      borderWidth: 2,
      body: TextField(
        controller: _controller,
        autofocus: true,
        minLines: 1,
        maxLines: 4,
        decoration: const InputDecoration(hintText: 'Your answer'),
        onSubmitted: widget.onSubmit,
      ),
      footer: Align(
        alignment: Alignment.centerRight,
        child: LiminalButton(
          label: 'Submit',
          onPressed: () => widget.onSubmit(_controller.text),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';

import '../../core/chat_visibility.dart';
import '../../state/message_models.dart';
import '../theme/liminal_theme_extension.dart';
import 'message_tile.dart';

/// Transcript list that auto-scrolls only when the user is already near the bottom.
class StickyMessageList extends StatefulWidget {
  const StickyMessageList({
    super.key,
    required this.messages,
    required this.showRawHarness,
    this.padding = const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
  });

  final List<MessageEntry> messages;
  final bool showRawHarness;
  final EdgeInsets padding;

  @override
  State<StickyMessageList> createState() => _StickyMessageListState();
}

class _StickyMessageListState extends State<StickyMessageList> {
  final _scroll = ScrollController();
  static const _stickThreshold = 120.0;

  @override
  void didUpdateWidget(covariant StickyMessageList oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.messages.length != oldWidget.messages.length ||
        _lastText(widget.messages) != _lastText(oldWidget.messages)) {
      _maybeScrollToEnd();
    }
  }

  String _lastText(List<MessageEntry> msgs) {
    if (msgs.isEmpty) return '';
    final last = msgs.last;
    return switch (last) {
      AssistantMessage(:final text) => text,
      UserMessage(:final text) => text,
      ThinkMessage(:final content) => content,
      _ => '',
    };
  }

  bool get _nearBottom {
    if (!_scroll.hasClients) return true;
    final max = _scroll.position.maxScrollExtent;
    return max - _scroll.offset <= _stickThreshold;
  }

  void _maybeScrollToEnd() {
    if (!_nearBottom) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final visible = visibleChatMessages(
      widget.messages,
      showRawHarness: widget.showRawHarness,
    );
    if (visible.isEmpty) {
      return Center(
        child: Text(
          'Send a message to start.',
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                color: lim.textMuted,
              ),
        ),
      );
    }

    return ListView.builder(
      controller: _scroll,
      padding: widget.padding,
      primary: false,
      itemCount: visible.length,
      itemBuilder: (context, i) {
        return MessageTile(
          entry: visible[i],
          verboseTools: widget.showRawHarness,
        );
      },
    );
  }
}

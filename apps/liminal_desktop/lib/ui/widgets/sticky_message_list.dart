import 'package:flutter/material.dart';

import '../../core/chat_visibility.dart';
import '../../state/message_models.dart';
import '../chat/transcript_lane.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import 'message_tile.dart';

/// Transcript list that auto-scrolls only when the user is already near the bottom.
class StickyMessageList extends StatefulWidget {
  const StickyMessageList({
    super.key,
    required this.messages,
    required this.showRawHarness,
    this.padding = const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
    this.personaLabel,
  });

  final List<MessageEntry> messages;
  final bool showRawHarness;
  final EdgeInsets padding;
  final String? personaLabel;

  @override
  State<StickyMessageList> createState() => _StickyMessageListState();
}

class _StickyMessageListState extends State<StickyMessageList> {
  final _scroll = ScrollController();
  static const _stickThreshold = 120.0;
  bool _pinnedToEnd = true;

  @override
  void initState() {
    super.initState();
    // Land at the newest message when a chat first opens.
    WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToEnd());
  }

  @override
  void didUpdateWidget(covariant StickyMessageList oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Follow every update — tool cards and in-place tool_start→tool_result
    // changes don't move messages.length or the last *text*, so gating on
    // those used to freeze the view exactly while the agent was working.
    // `_pinnedToEnd` is sampled against the pre-layout position so a user who
    // scrolled up to read is never yanked back down.
    if (_identicalTranscript(oldWidget)) return;
    if (_nearBottom) _maybeScrollToEnd();
  }

  bool _identicalTranscript(StickyMessageList oldWidget) =>
      identical(widget.messages, oldWidget.messages) &&
      widget.showRawHarness == oldWidget.showRawHarness;

  bool get _nearBottom {
    if (!_scroll.hasClients) return _pinnedToEnd;
    final max = _scroll.position.maxScrollExtent;
    return max - _scroll.offset <= _stickThreshold;
  }

  void _jumpToEnd() {
    if (!_scroll.hasClients) return;
    _scroll.jumpTo(_scroll.position.maxScrollExtent);
    _pinnedToEnd = true;
  }

  void _maybeScrollToEnd() {
    _pinnedToEnd = true;
    // Pin to the bottom after the new frame lays out. jumpTo (not animateTo)
    // because streaming fires many updates per second and overlapping
    // animations stutter; an instant pin reads as a live, following view.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.jumpTo(_scroll.position.maxScrollExtent);
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
    final persona = widget.personaLabel ?? lim.displayLabel;
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
        final entry = visible[i];
        final tile = MessageTile(
          entry: entry,
          verboseTools: widget.showRawHarness,
          personaLabel: persona,
        );
        if (isHarnessLaneMessage(entry)) {
          return TranscriptActivityLane(child: tile);
        }
        if (isConversationMessage(entry)) {
          return tile;
        }
        return Padding(
          padding: const EdgeInsets.only(bottom: LiminalSpacing.xs),
          child: tile,
        );
      },
    );
  }
}

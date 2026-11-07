import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show ScrollDirection;

import '../../core/chat_visibility.dart';
import '../../core/transcript_grouping.dart';
import '../../state/message_models.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import 'message_tile.dart';
import 'working_activity_panel.dart';

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
  bool _following = true;
  bool _followScheduled = false;

  @override
  void initState() {
    super.initState();
    _maybeScrollToEnd();
  }

  @override
  void didUpdateWidget(covariant StickyMessageList oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Entries can stream in place; comparing old/new references misses growth.
    _maybeScrollToEnd();
  }

  void _maybeScrollToEnd() {
    if (!_following || _followScheduled) return;
    _followScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _followScheduled = false;
      if (!mounted || !_following || !_scroll.hasClients) return;
      if (_scroll.position.extentAfter > 1) {
        _scroll.jumpTo(_scroll.position.maxScrollExtent);
      }
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
    final segments = groupTranscriptActivity(visible);
    if (visible.isEmpty) {
      return Center(
        child: Text(
          'Send a message to start.',
          style: Theme.of(
            context,
          ).textTheme.bodyLarge?.copyWith(color: lim.textMuted),
        ),
      );
    }

    return NotificationListener<UserScrollNotification>(
      onNotification: (notification) {
        if (notification.depth != 0) return false;
        if (notification.direction == ScrollDirection.forward) {
          _following = false;
        } else if (notification.metrics.extentAfter <= _stickThreshold) {
          _following = true;
        }
        return false;
      },
      child: NotificationListener<ScrollMetricsNotification>(
        onNotification: (notification) {
          if (notification.depth == 0 && notification.metrics.extentAfter > 1) {
            _maybeScrollToEnd();
          }
          return false;
        },
        child: ListView.builder(
          controller: _scroll,
          padding: widget.padding,
          primary: false,
          itemCount: segments.length,
          itemBuilder: (context, i) {
            final segment = segments[i];
            if (segment is TranscriptActivityGroupSegment) {
              return WorkingActivityPanel(
                entries: segment.entries,
                verboseTools: widget.showRawHarness,
                personaLabel: persona,
                startExpanded: widget.showRawHarness,
              );
            }
            final entry = (segment as TranscriptMessageSegment).entry;
            final tile = MessageTile(
              entry: entry,
              verboseTools: widget.showRawHarness,
              personaLabel: persona,
            );
            if (isConversationMessage(entry)) {
              return tile;
            }
            return Padding(
              padding: const EdgeInsets.only(bottom: LiminalSpacing.xs),
              child: tile,
            );
          },
        ),
      ),
    );
  }
}

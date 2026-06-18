import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/turn_activity.dart';
import '../../state/message_models.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';

/// Visible feedback while a turn is running but nothing has appeared in the transcript yet.
class TurnActivityBanner extends StatefulWidget {
  const TurnActivityBanner({
    super.key,
    required this.busy,
    required this.messages,
  });

  final bool busy;
  final List<MessageEntry> messages;

  @override
  State<TurnActivityBanner> createState() => _TurnActivityBannerState();
}

class _TurnActivityBannerState extends State<TurnActivityBanner> {
  Timer? _timer;
  DateTime? _startedAt;

  @override
  void initState() {
    super.initState();
    _syncTimer();
  }

  @override
  void didUpdateWidget(covariant TurnActivityBanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncTimer();
  }

  void _syncTimer() {
    final show = chatAwaitingVisibleActivity(
      widget.messages,
      busy: widget.busy,
    );
    if (!show) {
      _timer?.cancel();
      _timer = null;
      _startedAt = null;
      return;
    }
    _startedAt ??= DateTime.now();
    _timer ??= Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!chatAwaitingVisibleActivity(widget.messages, busy: widget.busy)) {
      return const SizedBox.shrink();
    }
    final lim = LiminalTheme.of(context);
    final elapsed = _startedAt == null
        ? 0
        : DateTime.now().difference(_startedAt!).inSeconds;
    final retry = latestProviderRetryHint(widget.messages);

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        LiminalSpacing.md,
        LiminalSpacing.xs,
        LiminalSpacing.md,
        LiminalSpacing.xs,
      ),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: lim.panel.withValues(alpha: 0.72),
          borderRadius: BorderRadius.circular(lim.radius * 0.55),
          border: Border.all(color: lim.accent.withValues(alpha: 0.35)),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: lim.accent,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      elapsed > 0
                          ? 'Working… ${elapsed}s'
                          : 'Working…',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: lim.text,
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      retry ??
                          'Connecting tools and model — activity will appear here.',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: lim.textMuted,
                            height: 1.3,
                          ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

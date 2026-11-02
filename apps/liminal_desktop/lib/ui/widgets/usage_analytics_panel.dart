import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/usage/usage_analytics.dart';

class UsageAnalyticsPanel extends StatefulWidget {
  const UsageAnalyticsPanel(
      {super.key,
      required this.analytics,
      this.compact = false,
      this.onChoice,});
  final UsageAnalytics analytics;
  final bool compact;
  final Future<void> Function(bool)? onChoice;

  @override
  State<UsageAnalyticsPanel> createState() => _UsageAnalyticsPanelState();
}

class _UsageAnalyticsPanelState extends State<UsageAnalyticsPanel> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _choose(bool value) =>
      _run(() => (widget.onChoice ?? widget.analytics.choose)(value));

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: widget.analytics,
        builder: (context, _) {
          final analytics = widget.analytics;
          if (!analytics.initialized ||
              (widget.compact &&
                  (!analytics.available || analytics.choice != null))) {
            return const SizedBox.shrink();
          }
          return Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              border: Border.all(
                  color: Theme.of(context).colorScheme.outlineVariant,),
              borderRadius: BorderRadius.circular(12),
            ),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                  widget.compact
                      ? 'Help improve Liminal?'
                      : 'Optional usage sharing',
                  style: Theme.of(context).textTheme.titleMedium,),
              const SizedBox(height: 8),
              const Text(
                  'Share first launches, workspace readiness and days with completed conversations, linked by a random identifier. Includes app version and platform. No prompts, answers, files or account details. Off by default.',),
              const SizedBox(height: 8),
              if (!analytics.available)
                const Text(
                    'Usage sharing is disabled in this development or capture build.',)
              else if (widget.compact)
                Wrap(spacing: 12, children: [
                  FilledButton(
                      onPressed: _busy ? null : () => _choose(true),
                      child: const Text('Share basic usage'),),
                  TextButton(
                      onPressed: _busy ? null : () => _choose(false),
                      child: const Text('No thanks'),),
                ],)
              else ...[
                SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Share basic usage with Vireon'),
                    subtitle: const Text(
                        'Turn off to stop future sharing. You can delete shared history separately below.',),
                    value: analytics.sharing,
                    onChanged: _busy ? null : _choose,),
                if (analytics.hasSharedIdentity)
                  TextButton(
                      onPressed: _busy
                          ? null
                          : () => _run(analytics.deleteSharedHistory),
                      child: const Text(
                          'Delete shared usage history and turn off',),),
              ],
              TextButton(
                  onPressed: () => launchUrl(
                      Uri.parse('https://www.vireondynamics.com/legal/privacy'),
                      mode: LaunchMode.externalApplication,),
                  child: const Text('Privacy and data retention'),),
              if (analytics.error != null)
                Text(analytics.error!,
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error),),
            ],),
          );
        },
      );
}

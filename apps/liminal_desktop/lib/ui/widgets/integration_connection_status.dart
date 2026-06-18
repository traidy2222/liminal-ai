import 'package:flutter/material.dart';

import '../theme/liminal_theme_extension.dart';

enum IntegrationStatusMode { simple, oauthMcp, oauthAutoAttach }

class IntegrationConnectionStatus extends StatelessWidget {
  const IntegrationConnectionStatus({
    super.key,
    required this.mode,
    this.signedIn,
    this.toolsAttached,
    this.simpleConnected,
    this.compact = false,
  });

  final IntegrationStatusMode mode;
  final bool? signedIn;
  final bool? toolsAttached;
  final bool? simpleConnected;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    switch (mode) {
      case IntegrationStatusMode.simple:
        return _StatusPill(
          ok: simpleConnected == true,
          label: simpleConnected == true ? 'Connected' : 'Not connected',
          color: simpleConnected == true ? lim.success : lim.warn,
          compact: compact,
        );
      case IntegrationStatusMode.oauthAutoAttach:
        return _StatusPill(
          ok: signedIn == true,
          label: signedIn == true ? 'Signed in' : 'Not signed in',
          color: signedIn == true ? lim.success : lim.warn,
          compact: compact,
        );
      case IntegrationStatusMode.oauthMcp:
        return Wrap(
          alignment: compact ? WrapAlignment.start : WrapAlignment.center,
          spacing: compact ? 4 : 6,
          runSpacing: compact ? 2 : 4,
          children: [
            _StatusPill(
              ok: signedIn == true,
              label: signedIn == true ? 'Signed in' : 'Sign in',
              color: signedIn == true ? lim.success : lim.warn,
              compact: compact,
            ),
            _StatusPill(
              ok: toolsAttached == true,
              label: toolsAttached == true ? 'Tools on' : 'Tools off',
              color: toolsAttached == true ? lim.success : lim.warn,
              compact: compact,
            ),
          ],
        );
    }
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.ok,
    required this.label,
    required this.color,
    this.compact = false,
  });

  final bool ok;
  final String label;
  final Color color;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: compact ? 6 : 8, vertical: compact ? 1 : 2),
      decoration: BoxDecoration(
        border: Border.all(color: color.withValues(alpha: 0.55)),
        borderRadius: BorderRadius.circular(compact ? 4 : 12),
      ),
      child: Text(
        label,
        style: TextStyle(color: color, fontSize: compact ? 9 : 10),
      ),
    );
  }
}

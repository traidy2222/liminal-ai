import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../state/app_controller.dart';
import '../design_system/liminal_design_system.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';

/// Thin status strip for sidecar connectivity (live / reconnecting / offline).
class ConnectionStatusStrip extends StatelessWidget {
  const ConnectionStatusStrip({super.key});

  @override
  Widget build(BuildContext context) {
    final host = AppScope.watch(context);
    final lim = LiminalThemeExtension.of(context).tokens;
    final phase = host.phase;
    final notice = host.connectionNotice;

    if (phase == ConnectionPhase.booting ||
        (phase == ConnectionPhase.connected && notice == null)) {
      return const SizedBox.shrink();
    }

    final bool reconnecting = phase == ConnectionPhase.reconnecting;
    final bool errored = phase == ConnectionPhase.error;
    final Color bg = reconnecting
        ? lim.warn.withValues(alpha: 0.18)
        : errored
            ? lim.danger.withValues(alpha: 0.18)
            : lim.accent.withValues(alpha: 0.14);
    final Color fg = reconnecting
        ? lim.warn
        : errored
            ? lim.danger
            : lim.accent;
    final String label = notice ??
        (reconnecting
            ? 'Reconnecting to sidecar…'
            : errored
                ? (host.bootError ?? 'Connection lost')
                : 'Connection issue');

    return Material(
      color: bg,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: LiminalSpacing.md,
            vertical: LiminalSpacing.xs,
          ),
          child: Row(
            children: [
              if (reconnecting)
                Padding(
                  padding: const EdgeInsets.only(right: LiminalSpacing.sm),
                  child: SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: fg,
                    ),
                  ),
                )
              else
                Padding(
                  padding: const EdgeInsets.only(right: LiminalSpacing.sm),
                  child: Icon(
                    errored ? Icons.cloud_off_outlined : Icons.cloud_done_outlined,
                    size: 16,
                    color: fg,
                  ),
                ),
              Expanded(
                child: Text(
                  label,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: fg,
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ),
              if (errored || !reconnecting)
                TextButton(
                  onPressed: host.connectionRecoverBusy
                      ? null
                      : () => host.retryConnection(),
                  style: TextButton.styleFrom(
                    foregroundColor: fg,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: const Text('Reconnect'),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

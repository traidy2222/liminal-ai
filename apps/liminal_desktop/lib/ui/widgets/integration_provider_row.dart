import 'package:flutter/material.dart';

import '../design_system/liminal_design_system.dart';
import '../theme/liminal_theme_extension.dart';
import 'integration_brand_icon.dart';
import 'integration_connection_status.dart';
import 'integration_provider_ui.dart';

/// Compact horizontal integration row — tap chevron for settings, button for action.
class IntegrationProviderRow extends StatelessWidget {
  const IntegrationProviderRow({
    super.key,
    required this.brandId,
    required this.presentation,
    required this.expanded,
    required this.disabled,
    required this.onToggleDetails,
    required this.onAction,
    this.details,
    this.showDivider = true,
  });

  final IntegrationBrandId brandId;
  final IntegrationProviderPresentation presentation;
  final bool expanded;
  final bool disabled;
  final VoidCallback onToggleDetails;
  final VoidCallback onAction;
  final Widget? details;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final brand = integrationBrands[brandId]!;
    final hasDetails = details != null;

    return Column(
      children: [
        Material(
          color: presentation.highlight
              ? lim.success.withValues(alpha: 0.04)
              : Colors.transparent,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                IntegrationBrandIcon(id: brandId, size: 36),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        brand.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        presentation.nextStep,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: lim.textMuted, fontSize: 11, height: 1.25),
                      ),
                      const SizedBox(height: 4),
                      IntegrationConnectionStatus(
                        mode: presentation.statusMode,
                        signedIn: presentation.signedIn,
                        toolsAttached: presentation.toolsAttached,
                        simpleConnected: presentation.ready,
                        compact: true,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                if (presentation.showAction)
                  LiminalButton(
                    label: presentation.actionLabel,
                    dense: true,
                    variant: presentation.actionDanger
                        ? LiminalButtonVariant.danger
                        : presentation.ready
                            ? LiminalButtonVariant.secondary
                            : LiminalButtonVariant.primary,
                    onPressed: disabled ? null : onAction,
                  ),
                if (hasDetails) ...[
                  const SizedBox(width: 4),
                  IconButton(
                    tooltip: expanded ? 'Hide settings' : 'Settings',
                    visualDensity: VisualDensity.compact,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                    onPressed: disabled ? null : onToggleDetails,
                    icon: Icon(
                      expanded ? Icons.expand_less : Icons.tune,
                      size: 20,
                      color: lim.textMuted,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        if (expanded && details != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(46, 0, 8, 10),
            child: details!,
          ),
        if (showDivider)
          Divider(height: 1, thickness: 1, color: lim.accent.withValues(alpha: 0.08), indent: 46),
      ],
    );
  }
}

class IntegrationProviderGroup extends StatelessWidget {
  const IntegrationProviderGroup({
    super.key,
    required this.title,
    this.subtitle,
    required this.children,
  });

  final String title;
  final String? subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return LiminalSection(
      title: title,
      subtitle: subtitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: children,
      ),
    );
  }
}

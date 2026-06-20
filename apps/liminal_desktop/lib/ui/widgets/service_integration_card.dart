import 'package:flutter/material.dart';

import '../../models/integrations_snapshot.dart';
import '../design_system/liminal_design_system.dart';
import '../theme/liminal_theme_extension.dart';
import 'integration_brand_icon.dart';
import 'integration_connection_status.dart';

/// One bubble per workspace service — Gmail, Calendar, Outlook, Azure compute, etc.
class ServiceIntegrationCard extends StatelessWidget {
  const ServiceIntegrationCard({
    super.key,
    required this.card,
    required this.expanded,
    required this.disabled,
    required this.onToggle,
    required this.onConnect,
    this.details,
  });

  final IntegrationServiceCard card;
  final bool expanded;
  final bool disabled;
  final VoidCallback onToggle;
  final VoidCallback onConnect;
  final Widget? details;

  IntegrationBrandId get _brandId {
    switch (card.vendor) {
      case 'azure':
        return IntegrationBrandId.azure;
      case 'microsoft':
        return IntegrationBrandId.microsoft;
      default:
        return IntegrationBrandId.google;
    }
  }

  String get _statusLine {
    if (card.connected) {
      if (card.toolCount > 0) return 'Ready · ${card.toolCount} tools';
      if (card.restOnly) return 'Scopes granted';
      return 'Connected';
    }
    if (card.needsScopeReconnect) return 'Reconnect for scopes';
    if (card.signedIn) return 'Tap to enable';
    return card.groupLabel;
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final borderColor = card.connected
        ? lim.success.withValues(alpha: 0.35)
        : lim.accent.withValues(alpha: 0.12);
    final bg = card.connected
        ? lim.success.withValues(alpha: 0.04)
        : lim.surface.withValues(alpha: 0.55);

    return Material(
      color: bg,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: borderColor),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: disabled ? null : onToggle,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(10, 10, 10, 8),
              child: Column(
                children: [
                  IntegrationBrandIcon(id: _brandId, size: 36),
                  const SizedBox(height: 8),
                  Text(
                    card.label,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _statusLine,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    style: TextStyle(color: lim.textMuted, fontSize: 10, height: 1.35),
                  ),
                  const SizedBox(height: 6),
                  IntegrationConnectionStatus(
                    mode: IntegrationStatusMode.oauthAutoAttach,
                    signedIn: card.signedIn,
                    toolsAttached: card.connected,
                    compact: true,
                  ),
                  const SizedBox(height: 8),
                  if (!card.connected)
                    LiminalButton(
                      label: 'Connect',
                      dense: true,
                      onPressed: disabled ? null : onConnect,
                    )
                  else
                    Text('Active', style: TextStyle(color: lim.success, fontSize: 10)),
                  const SizedBox(height: 4),
                  Text(
                    expanded ? 'Hide ▴' : 'Options ▾',
                    style: TextStyle(color: lim.textDim, fontSize: 9),
                  ),
                ],
              ),
            ),
          ),
          if (expanded && details != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: details!,
            ),
        ],
      ),
    );
  }
}

/// Category block with a responsive grid of per-service bubbles.
class IntegrationCategorySection extends StatelessWidget {
  const IntegrationCategorySection({
    super.key,
    required this.title,
    this.subtitle,
    required this.cards,
    required this.expandedId,
    required this.disabled,
    required this.expandIdFor,
    required this.onToggle,
    required this.onConnect,
    this.detailsFor,
    this.footer,
  });

  final String title;
  final String? subtitle;
  final List<IntegrationServiceCard> cards;
  final String? expandedId;
  final bool disabled;
  final String Function(IntegrationServiceCard card) expandIdFor;
  final ValueChanged<IntegrationServiceCard> onToggle;
  final ValueChanged<IntegrationServiceCard> onConnect;
  final Widget Function(IntegrationServiceCard card)? detailsFor;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, letterSpacing: 0.4),
        ),
        if (subtitle != null) ...[
          const SizedBox(height: 4),
          Text(subtitle!, style: TextStyle(color: lim.textMuted, fontSize: 11, height: 1.4)),
        ],
        const SizedBox(height: 10),
        LayoutBuilder(
          builder: (context, constraints) {
            const cardWidth = 152.0;
            return Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                for (final card in cards)
                  Builder(
                    builder: (context) {
                      final id = expandIdFor(card);
                      final expanded = expandedId == id;
                      return SizedBox(
                        width: expanded ? constraints.maxWidth : cardWidth,
                        child: ServiceIntegrationCard(
                          card: card,
                          expanded: expanded,
                          disabled: disabled,
                          onToggle: () => onToggle(card),
                          onConnect: () => onConnect(card),
                          details: detailsFor?.call(card),
                        ),
                      );
                    },
                  ),
              ],
            );
          },
        ),
        if (footer != null) ...[
          const SizedBox(height: 10),
          footer!,
        ],
        const SizedBox(height: 16),
      ],
    );
  }
}

import 'package:flutter/material.dart';

import '../../models/integrations_snapshot.dart';
import '../theme/liminal_theme_extension.dart';

class WorkspaceServicePicker extends StatelessWidget {
  const WorkspaceServicePicker({
    super.key,
    required this.groups,
    required this.presets,
    required this.selected,
    required this.disabled,
    required this.onToggle,
    required this.onApplyPreset,
  });

  final List<WorkspaceServiceGroup> groups;
  final List<WorkspaceConnectPreset> presets;
  final Set<String> selected;
  final bool disabled;
  final ValueChanged<String> onToggle;
  final ValueChanged<List<String>> onApplyPreset;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Quick presets', style: TextStyle(color: lim.textMuted, fontSize: 11)),
        const SizedBox(height: 6),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final preset in presets)
              FilterChip(
                label: Text(preset.label, style: const TextStyle(fontSize: 11)),
                selected: preset.services.length == selected.length &&
                    preset.services.every(selected.contains),
                onSelected: disabled ? null : (_) => onApplyPreset(preset.services),
              ),
          ],
        ),
        const SizedBox(height: 8),
        for (final group in groups) ...[
          Text(
            group.label.toUpperCase(),
            style: TextStyle(
              color: lim.textMuted.withValues(alpha: 0.85),
              fontSize: 10,
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final service in group.services)
                FilterChip(
                  label: Text(service, style: const TextStyle(fontSize: 11)),
                  selected: selected.contains(service),
                  onSelected: disabled ? null : (_) => onToggle(service),
                ),
            ],
          ),
          const SizedBox(height: 8),
        ],
      ],
    );
  }
}

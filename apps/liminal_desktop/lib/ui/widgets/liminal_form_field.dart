import 'package:flutter/material.dart';

import '../../models/harness_settings.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';

/// One harness setting — label + description above, control + action in a row.
class LiminalHarnessField extends StatelessWidget {
  const LiminalHarnessField({
    super.key,
    required this.field,
    required this.controller,
    required this.onApply,
    this.enabled = true,
  });

  final HarnessSettingsField field;
  final TextEditingController? controller;
  final ValueChanged<String> onApply;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final locked = field.lockedByEnv || !enabled;
    final theme = Theme.of(context);

    if (field.valueKind == 'boolean') {
      return _SettingCard(
        child: SwitchListTile(
          contentPadding: const EdgeInsets.symmetric(horizontal: 4),
          title: Text(
            field.label,
            style: theme.textTheme.titleSmall?.copyWith(color: lim.text),
          ),
          subtitle: _descriptionBlock(context, field, locked),
          value: field.value == '1' || field.value.toLowerCase() == 'on',
          onChanged: locked ? null : (v) => onApply(v ? '1' : '0'),
        ),
      );
    }

    if (field.valueKind == 'enum') {
      return _SettingCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _labelHeader(context, field, locked),
            const SizedBox(height: LiminalSpacing.sm),
            _EnumField(
              field: field,
              locked: locked,
              onApply: onApply,
            ),
          ],
        ),
      );
    }

    return _SettingCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _labelHeader(context, field, locked),
          const SizedBox(height: LiminalSpacing.sm),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  controller: controller,
                  enabled: !locked,
                  style: theme.textTheme.bodyLarge?.copyWith(color: lim.text),
                  minLines: _minLines(field),
                  maxLines: _maxLines(field),
                  decoration: InputDecoration(
                    hintText: field.key,
                    isDense: false,
                  ),
                  onSubmitted: locked ? null : onApply,
                ),
              ),
              const SizedBox(width: LiminalSpacing.sm),
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: FilledButton.tonal(
                  onPressed: locked
                      ? null
                      : () => onApply(controller?.text ?? field.value),
                  child: const Text('Apply'),
                ),
              ),
            ],
          ),
          if (_showEffectiveChip(field))
            Padding(
              padding: const EdgeInsets.only(top: LiminalSpacing.xs),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Chip(
                  visualDensity: VisualDensity.compact,
                  label: Text(
                    'Effective: ${field.effectiveDisplay}',
                    style: theme.textTheme.labelSmall,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  static int _minLines(HarnessSettingsField field) =>
      field.value.length > 60 ? 2 : 1;

  static int _maxLines(HarnessSettingsField field) =>
      field.value.length > 120 ? 5 : 2;

  static bool _showEffectiveChip(HarnessSettingsField field) {
    final d = field.effectiveDisplay;
    if (d == null || d.isEmpty) return false;
    return d != field.value && field.valueKind != 'boolean';
  }

  static Widget? _descriptionBlock(
    BuildContext context,
    HarnessSettingsField field,
    bool locked,
  ) {
    final parts = <String>[];
    if (field.description != null && field.description!.isNotEmpty) {
      parts.add(field.description!);
    }
    if (locked) parts.add('Locked by environment');
    if (parts.isEmpty) return null;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Text(
        parts.join(' · '),
        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: LiminalTheme.of(context).textMuted,
              height: 1.4,
            ),
      ),
    );
  }

  static Widget _labelHeader(
    BuildContext context,
    HarnessSettingsField field,
    bool locked,
  ) {
    final lim = LiminalTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                field.label,
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: lim.text,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ),
            if (locked)
              Chip(
                visualDensity: VisualDensity.compact,
                label: Text('Locked', style: Theme.of(context).textTheme.labelSmall),
              ),
          ],
        ),
        if (field.description != null && field.description!.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              field.description!,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: lim.textMuted,
                    height: 1.45,
                  ),
            ),
          ),
      ],
    );
  }
}

class _SettingCard extends StatelessWidget {
  const _SettingCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: lim.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(lim.radius),
        border: Border.all(color: lim.border.withValues(alpha: 0.65)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(LiminalSpacing.md),
        child: child,
      ),
    );
  }
}

class _EnumField extends StatefulWidget {
  const _EnumField({
    required this.field,
    required this.locked,
    required this.onApply,
  });

  final HarnessSettingsField field;
  final bool locked;
  final ValueChanged<String> onApply;

  @override
  State<_EnumField> createState() => _EnumFieldState();
}

class _EnumFieldState extends State<_EnumField> {
  late String _value;

  @override
  void initState() {
    super.initState();
    _value = widget.field.value;
  }

  @override
  void didUpdateWidget(covariant _EnumField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.field.value != widget.field.value) {
      _value = widget.field.value;
    }
  }

  @override
  Widget build(BuildContext context) {
    final options = widget.field.enumValues ?? [_value];
    final selected = options.contains(_value) ? _value : options.first;

    return DropdownButtonFormField<String>(
      key: ValueKey('${widget.field.key}-$selected'),
      initialValue: selected,
      isExpanded: true,
      style: Theme.of(context).textTheme.bodyLarge,
      decoration: const InputDecoration(
        hintText: 'Select value',
        isDense: false,
      ),
      items: [
        for (final o in options)
          DropdownMenuItem(
            value: o,
            child: Text(o, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: widget.locked
          ? null
          : (v) {
              if (v == null) return;
              setState(() => _value = v);
              widget.onApply(v);
            },
    );
  }
}

/// Provider / onboarding text field — label above the box (no floating overlap).
class LiminalTextField extends StatelessWidget {
  const LiminalTextField({
    super.key,
    required this.controller,
    required this.label,
    this.hint,
    this.helper,
    this.obscure = false,
    this.enabled = true,
    this.minLines = 1,
    this.maxLines = 1,
  });

  final TextEditingController controller;
  final String label;
  final String? hint;
  final String? helper;
  final bool obscure;
  final bool enabled;
  final int minLines;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: LiminalSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            label,
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  color: lim.text,
                  fontWeight: FontWeight.w600,
                ),
          ),
          if (helper != null && helper!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              helper!,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: lim.textMuted,
                    height: 1.35,
                  ),
            ),
          ],
          const SizedBox(height: LiminalSpacing.sm),
          TextField(
            controller: controller,
            obscureText: obscure,
            enabled: enabled,
            minLines: minLines,
            maxLines: maxLines,
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: lim.text),
            decoration: InputDecoration(
              hintText: hint,
              floatingLabelBehavior: FloatingLabelBehavior.never,
            ),
          ),
        ],
      ),
    );
  }
}

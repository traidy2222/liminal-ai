import 'package:flutter/material.dart';

import '../../models/harness_settings.dart';
import '../../models/settings_presentation.dart';
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

    if (field.valueKind == 'boolean' || field.key == 'AGENT_TTS_ENABLED') {
      return _SettingCard(
        child: SwitchListTile(
          contentPadding: const EdgeInsets.symmetric(horizontal: 4),
          title: Text(
            everydaySettings[field.key]?.label ?? field.label,
            style: theme.textTheme.titleSmall?.copyWith(color: lim.text),
          ),
          subtitle: _descriptionBlock(context, field, locked),
          value: const {'1', 'on', 'true', 'yes'}
              .contains(field.value.toLowerCase()),
          onChanged: locked ? null : (v) => onApply(v ? '1' : '0'),
        ),
      );
    }

    if (field.valueKind == 'enum' || field.key == 'AGENT_EFFORT') {
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
          if (field.key == 'AGENT_TTS_MODEL') ...[
            const SizedBox(height: LiminalSpacing.sm),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton(
                onPressed: locked || field.value == 'local/jarvis-warm'
                    ? null
                    : () {
                        controller?.text = 'local/jarvis-warm';
                        onApply('local/jarvis-warm');
                      },
                child: Text(
                  field.value == 'local/jarvis-warm'
                      ? 'JARVIS Warm selected'
                      : 'Use JARVIS Warm — local',
                ),
              ),
            ),
            const Text(
              'Install once with liminal voice install (about 3 GB of models). No speech API key required.',
            ),
          ],
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
    final description =
        everydaySettings[field.key]?.description ?? field.description;
    if (description != null && description.isNotEmpty) {
      parts.add(description);
    }
    if (field.lockedByEnv) parts.add('Managed in your environment file');
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
                everydaySettings[field.key]?.label ?? field.label,
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: lim.text,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ),
            if (field.lockedByEnv)
              Chip(
                visualDensity: VisualDensity.compact,
                label: Text(
                  'Locked',
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ),
          ],
        ),
        if (field.description != null && field.description!.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              everydaySettings[field.key]?.description ?? field.description!,
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
        color: lim.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: lim.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(LiminalSpacing.md),
        child: Material(type: MaterialType.transparency, child: child),
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
  late String _customValue;

  @override
  void initState() {
    super.initState();
    _value = widget.field.value;
    _customValue = _value;
  }

  @override
  void didUpdateWidget(covariant _EnumField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.field.value != widget.field.value) {
      _value = widget.field.value;
      _customValue = _value;
    }
  }

  @override
  Widget build(BuildContext context) {
    final options = widget.field.key == 'AGENT_EFFORT'
        ? ['low', 'medium', 'high', 'xhigh']
        : widget.field.enumValues ?? [_value];
    final choices = <String>{...options, _value}.toList();
    final selected = _value;

    final dropdown = DropdownButtonFormField<String>(
      key: ValueKey('${widget.field.key}-$selected'),
      initialValue: selected,
      isExpanded: true,
      style: Theme.of(context).textTheme.bodyLarge,
      decoration: const InputDecoration(
        hintText: 'Select value',
        isDense: false,
      ),
      items: [
        for (final o in choices)
          DropdownMenuItem(
            value: o,
            child: Text(
              widget.field.key == 'AGENT_TRANSCRIBE_MODEL'
                  ? (const {
                        'local/whisper-large-v3-turbo':
                            'Whisper — Fast · local',
                        'local/qwen3-asr-1.7b': 'Qwen — Accuracy · local',
                      }[o] ??
                      o)
                  : o,
              overflow: TextOverflow.ellipsis,
            ),
          ),
      ],
      onChanged: widget.locked
          ? null
          : (v) {
              if (v == null) return;
              setState(() {
                _value = v;
                _customValue = v;
              });
              widget.onApply(v);
            },
    );
    if (widget.field.key != 'AGENT_TRANSCRIBE_MODEL') return dropdown;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      dropdown,
      ExpansionTile(
          title: const Text('Custom provider model'),
          tilePadding: EdgeInsets.zero,
          children: [
            TextFormField(
                key: ValueKey('custom-$_value'),
                initialValue: _value,
                enabled: !widget.locked,
                decoration: const InputDecoration(
                    labelText: 'Custom transcription model',
                    helperText: 'Cloud models use your configured provider.'),
                onChanged: (value) {
                  _customValue = value;
                }),
            Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                    onPressed: widget.locked
                        ? null
                        : () {
                            final value = _customValue.trim();
                            if (value.isEmpty) return;
                            setState(() {
                              _value = value;
                              _customValue = value;
                            });
                            widget.onApply(value);
                          },
                    child: const Text('Use custom model'))),
          ]),
    ]);
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
            style: Theme.of(context)
                .textTheme
                .bodyLarge
                ?.copyWith(color: lim.text),
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

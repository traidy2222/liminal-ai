import 'package:flutter/material.dart';

import '../design_system/liminal_design_system.dart';
import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';

/// Compact guide at top of integrations — two-step vs one-step flows.
class IntegrationsHowToStrip extends StatelessWidget {
  const IntegrationsHowToStrip({super.key});

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return LiminalCard(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'How it works',
            style: LiminalTypography.caption(context).copyWith(
              color: lim.accent,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.4,
            ),
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: _FlowColumn(
                  title: 'Workspace services',
                  subtitle: 'Gmail · Calendar · Outlook · Azure…',
                  steps: const ['Pick a service card', 'Connect'],
                  lim: lim,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _FlowColumn(
                  title: 'Everything else',
                  subtitle: 'Slack · Linear · Notion · Xero',
                  steps: const ['Sign in once'],
                  lim: lim,
                  singleStep: true,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _FlowColumn extends StatelessWidget {
  const _FlowColumn({
    required this.title,
    required this.subtitle,
    required this.steps,
    required this.lim,
    this.singleStep = false,
  });

  final String title;
  final String subtitle;
  final List<String> steps;
  final LiminalTokens lim;
  final bool singleStep;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: TextStyle(color: lim.text, fontSize: 12, fontWeight: FontWeight.w600)),
        const SizedBox(height: 2),
        Text(subtitle, style: TextStyle(color: lim.textDim, fontSize: 10, height: 1.3)),
        const SizedBox(height: 8),
        Row(
          children: [
            for (var i = 0; i < steps.length; i++) ...[
              if (i > 0) ...[
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: Icon(Icons.arrow_forward, size: 12, color: lim.textDim),
                ),
              ],
              _StepChip(label: '${i + 1}. ${steps[i]}', lim: lim),
            ],
            if (singleStep)
              Padding(
                padding: const EdgeInsets.only(left: 6),
                child: Text('→ tools on', style: TextStyle(color: lim.textMuted, fontSize: 10)),
              ),
          ],
        ),
      ],
    );
  }
}

class _StepChip extends StatelessWidget {
  const _StepChip({required this.label, required this.lim});

  final String label;
  final LiminalTokens lim;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: lim.accent.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: lim.accent.withValues(alpha: 0.22)),
      ),
      child: Text(
        label,
        style: TextStyle(color: lim.accent, fontSize: 10, fontWeight: FontWeight.w500),
      ),
    );
  }
}

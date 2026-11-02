import 'package:flutter/material.dart';
import '../theme/liminal_theme_extension.dart';
import 'liminal_brand.dart';

/// Task entry points, shared in language and hierarchy with the web workspace.
class WorkspaceWelcome extends StatelessWidget {
  const WorkspaceWelcome(
      {super.key, required this.onStart, this.title, this.body,});
  final ValueChanged<String> onStart;
  final String? title;
  final String? body;
  static const starters = [
    (Icons.explore_outlined, 'Enquiry to proposal', 'Research, scope, and an unsent reply', '/proposal '),
    (Icons.receipt_long_outlined, 'Receipt to expense', 'Attach a receipt and prepare a review', '/receipt '),
    (Icons.code_rounded, 'Bug to verified patch', 'Reproduce, fix, test, and hand off', '/fix '),
  ];

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 660;
        return Center(
          child: SingleChildScrollView(
            padding: EdgeInsets.symmetric(
              horizontal: compact ? 22 : 40,
              vertical: 30,
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 760),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  LiminalThresholdMark(size: compact ? 38 : 50),
                  const SizedBox(height: 24),
                  Text(
                    'A little space. A lot of possibility.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 11,
                      color: lim.textMuted,
                      letterSpacing: 0.3,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(
                          text: title ?? 'What are we\n',
                          style: TextStyle(color: lim.text),
                        ),
                        TextSpan(
                          text: title == null ? 'working on?' : '',
                          style: TextStyle(color: lim.accent),
                        ),
                      ],
                    ),
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontFamily: lim.fontFamilyHeading,
                      fontSize: compact ? 36 : 50,
                      fontWeight: FontWeight.w500,
                      letterSpacing: -1.7,
                      height: 1.12,
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text(
                    body ??
                        'Bring a question, a rough idea, or a project.\nWe’ll find the next step together.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 14,
                      height: 1.8,
                      color: lim.textMuted,
                    ),
                  ),
                  const SizedBox(height: 30),
                  if (compact)
                    ...starters.map(
                      (s) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _Starter(
                          icon: s.$1,
                          title: s.$2,
                          detail: s.$3,
                          compact: true,
                          onTap: () => onStart(s.$4),
                        ),
                      ),
                    )
                  else
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (var i = 0; i < starters.length; i++) ...[
                          if (i > 0) const SizedBox(width: 12),
                          Expanded(
                            child: _Starter(
                              icon: starters[i].$1,
                              title: starters[i].$2,
                              detail: starters[i].$3,
                              compact: false,
                              onTap: () => onStart(starters[i].$4),
                            ),
                          ),
                        ],
                      ],
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _Starter extends StatelessWidget {
  const _Starter({
    required this.icon,
    required this.title,
    required this.detail,
    required this.compact,
    required this.onTap,
  });
  final IconData icon;
  final String title;
  final String detail;
  final bool compact;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final text = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          title,
          style: TextStyle(
            color: lim.text,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          detail,
          style: TextStyle(fontSize: 11, height: 1.6, color: lim.textMuted),
        ),
      ],
    );
    return Material(
      color: lim.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: lim.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        hoverColor: lim.accent.withValues(alpha: 0.07),
        focusColor: lim.accent.withValues(alpha: 0.12),
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: compact
              ? Row(
                  children: [
                    Icon(icon, size: 21, color: lim.accent),
                    const SizedBox(width: 14),
                    Expanded(child: text),
                    Icon(Icons.north_east, size: 14, color: lim.textMuted),
                  ],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(icon, size: 22, color: lim.accent),
                        const Spacer(),
                        Icon(
                          Icons.north_east,
                          size: 14,
                          color: lim.textDim,
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    text,
                  ],
                ),
        ),
      ),
    );
  }
}

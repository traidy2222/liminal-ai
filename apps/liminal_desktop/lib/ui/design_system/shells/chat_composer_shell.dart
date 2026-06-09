import 'package:flutter/material.dart';

import '../../../models/persona_ui_layout.dart';
import '../../../models/persona_ui_theme.dart';
import '../../layout/liminal_spacing.dart';
import '../../theme/liminal_theme_extension.dart';
import '../primitives/liminal_card.dart';
import '../tokens/liminal_elevation.dart';
import 'persona_shell_style.dart';

/// Wraps the composer according to persona `inputDock` + shell.
class ChatComposerShell extends StatelessWidget {
  const ChatComposerShell({
    super.key,
    required this.theme,
    required this.layout,
    required this.child,
  });

  final PersonaUiTheme theme;
  final PersonaLayoutSpec layout;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final style = PersonaShellStyle.fromTheme(theme);
    final dock = layout.composerDock;

    if (dock == 'inline') {
      return Padding(
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
        child: child,
      );
    }

    if (dock == 'floating' || style.composerFloating) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: LiminalCard(
          elevation: LiminalElevation.mid,
          padding: const EdgeInsets.all(LiminalSpacing.sm),
          child: child,
        ),
      );
    }

    // bottom-bar (default)
    final border = style.composerBordered
        ? Border(top: BorderSide(color: lim.border, width: 1))
        : null;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: lim.panel.withValues(alpha: 0.88),
        border: border,
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 12),
        child: child,
      ),
    );
  }
}

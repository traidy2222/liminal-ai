import 'package:flutter/material.dart';

import '../../../models/persona_ui_theme.dart';
import '../../theme/liminal_theme_extension.dart';

/// Visual chrome derived from persona `shell` enum.
class PersonaShellStyle {
  const PersonaShellStyle({
    required this.shell,
    required this.showGrid,
    required this.headerCentered,
    required this.appBarTransparent,
    required this.composerFloating,
    required this.composerBordered,
    required this.transcriptMono,
  });

  final String shell;
  final bool showGrid;
  final bool headerCentered;
  final bool appBarTransparent;
  final bool composerFloating;
  final bool composerBordered;
  final bool transcriptMono;

  factory PersonaShellStyle.fromTheme(PersonaUiTheme theme) {
    final shell = theme.shell;
    return PersonaShellStyle(
      shell: shell,
      showGrid: theme.background == 'grid' && shell != 'minimal',
      headerCentered: shell == 'minimal' || shell == 'studio',
      appBarTransparent: shell == 'minimal' || shell == 'studio',
      composerFloating: theme.inputDock == 'floating' || shell == 'studio',
      composerBordered: shell != 'minimal',
      transcriptMono: shell == 'terminal',
    );
  }

  BorderSide? appBarBottomSide(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return switch (shell) {
      'terminal' => BorderSide(color: lim.success.withValues(alpha: 0.35), width: 1),
      'hud' => BorderSide(color: lim.accent.withValues(alpha: 0.25), width: 1),
      'minimal' => null,
      _ => BorderSide(color: lim.border),
    };
  }

  Color appBarBackground(BuildContext context) {
    final lim = LiminalTheme.of(context);
    if (appBarTransparent) return lim.panel.withValues(alpha: 0.55);
    return lim.panel.withValues(alpha: 0.92);
  }
}

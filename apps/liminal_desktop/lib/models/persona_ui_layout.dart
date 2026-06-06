import 'persona_ui_theme.dart';

/// Declarative region layout (mirrors core `PersonaLayoutSpec`).
///
/// Derived from the persona theme's enums so existing personas need no
/// migration. The composer is always present (structural invariant), so it is
/// not represented as optional here — only its dock varies.
class PersonaLayoutSpec {
  const PersonaLayoutSpec({
    required this.headerPresent,
    required this.headerCentered,
    required this.composerDock,
    required this.transcriptMaxWidth,
  });

  final bool headerPresent;
  final bool headerCentered;

  /// `bottom-bar` | `floating` | `inline`.
  final String composerDock;

  /// 0 = transcript fills width; otherwise a px max-width cap on the column.
  final double transcriptMaxWidth;

  factory PersonaLayoutSpec.fromTheme(PersonaUiTheme theme) {
    final capped = theme.shell == 'studio' || theme.shell == 'minimal';
    return PersonaLayoutSpec(
      headerPresent: theme.headerStyle != 'none',
      headerCentered: theme.shell == 'minimal' || theme.shell == 'studio',
      composerDock: theme.inputDock,
      transcriptMaxWidth: capped ? 820 : 0,
    );
  }
}

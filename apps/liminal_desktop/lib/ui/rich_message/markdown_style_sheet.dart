import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';

/// Web `App.tsx` / `.lim-md` parity for assistant markdown.
MarkdownStyleSheet liminalMarkdownStyleSheet(
  BuildContext context,
  LiminalTokens lim,
) {
  final base = Theme.of(context).textTheme.bodyLarge?.copyWith(
        color: lim.text,
        height: 1.72,
      );
  return MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
    p: base,
    pPadding: const EdgeInsets.only(bottom: 10),
    blockSpacing: 8,
    listIndent: 24,
    listBullet: base,
    listBulletPadding: const EdgeInsets.only(right: 8),
    h1: Theme.of(context).textTheme.titleLarge?.copyWith(
          color: lim.success,
          fontWeight: FontWeight.w700,
          height: 1.3,
        ),
    h1Padding: const EdgeInsets.only(top: 12, bottom: 8),
    h2: Theme.of(context).textTheme.titleMedium?.copyWith(
          color: lim.accent,
          fontWeight: FontWeight.w700,
          height: 1.35,
        ),
    h2Padding: const EdgeInsets.only(top: 10, bottom: 6),
    h3: Theme.of(context).textTheme.titleSmall?.copyWith(
          color: lim.text,
          fontWeight: FontWeight.w600,
          height: 1.4,
        ),
    h3Padding: const EdgeInsets.only(top: 8, bottom: 4),
    h4: LiminalTheme.mono(
      context,
      fontSize: 13,
      fontWeight: FontWeight.w600,
      color: lim.warn,
    ).copyWith(letterSpacing: 0.6),
    h4Padding: const EdgeInsets.only(top: 6, bottom: 4),
    h5: base?.copyWith(fontWeight: FontWeight.w600),
    h6: base?.copyWith(fontWeight: FontWeight.w600, color: lim.textMuted),
    strong: base?.copyWith(fontWeight: FontWeight.w700, color: lim.text),
    em: base?.copyWith(fontStyle: FontStyle.italic, color: lim.textMuted),
    a: TextStyle(
      color: lim.accent,
      decoration: TextDecoration.underline,
      decorationStyle: TextDecorationStyle.dotted,
      decorationColor: lim.accent.withValues(alpha: 0.45),
    ),
    // Subtle inline highlight — not full-width code blocks.
    code: TextStyle(
      fontFamily: lim.fontFamilyMono,
      fontSize: 12,
      height: 1.45,
      color: lim.success,
      backgroundColor: lim.surface.withValues(alpha: 0.85),
    ),
    codeblockDecoration: BoxDecoration(
      color: lim.codeBackground,
      borderRadius: BorderRadius.circular(6),
      border: Border.all(color: lim.border.withValues(alpha: 0.45)),
    ),
    codeblockPadding: const EdgeInsets.all(12),
    blockquote: Theme.of(context).textTheme.bodyMedium?.copyWith(
          color: lim.textMuted,
          fontStyle: FontStyle.italic,
          height: 1.5,
        ),
    blockquotePadding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
    blockquoteDecoration: BoxDecoration(
      color: lim.surface.withValues(alpha: 0.45),
      border: Border(
        left: BorderSide(color: lim.border.withValues(alpha: 0.65), width: 2),
      ),
      borderRadius: const BorderRadius.horizontal(right: Radius.circular(4)),
    ),
    horizontalRuleDecoration: BoxDecoration(
      border: Border(
        top: BorderSide(
          color: lim.border.withValues(alpha: 0.35),
          width: 1,
        ),
      ),
    ),
    tableHead: LiminalTheme.mono(
      context,
      fontSize: 11,
      fontWeight: FontWeight.w700,
      color: lim.textMuted,
    ),
    tableBody: base?.copyWith(color: lim.textMuted, fontSize: 13),
    tableBorder: TableBorder.all(color: lim.border.withValues(alpha: 0.45)),
    tableCellsPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
  );
}

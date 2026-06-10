import 'package:flutter/material.dart';

import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';

/// Role-labeled conversation frame for user and assistant turns.
class ChatMessageFrame extends StatelessWidget {
  const ChatMessageFrame.user({
    super.key,
    required this.child,
  })  : roleLabel = 'You',
        alignEnd = true,
        accentRole = true;

  const ChatMessageFrame.assistant({
    super.key,
    required this.roleLabel,
    required this.child,
  })  : alignEnd = false,
        accentRole = false;

  final String roleLabel;
  final Widget child;
  final bool alignEnd;
  final bool accentRole;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final style = lim.messageStyle;
    final roleColor = accentRole ? lim.accent : lim.assistantAccent;
    final width = MediaQuery.sizeOf(context).width;

    final header = Padding(
      padding: EdgeInsets.only(
        bottom: LiminalSpacing.xxs,
        left: alignEnd ? 0 : 2,
        right: alignEnd ? 2 : 0,
      ),
      child: Row(
        mainAxisAlignment:
            alignEnd ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          if (!alignEnd) ...[
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: roleColor.withValues(alpha: 0.85),
              ),
            ),
            const SizedBox(width: 6),
          ],
          Text(
            roleLabel.toUpperCase(),
            style: LiminalTheme.mono(
              context,
              fontSize: 10,
              fontWeight: FontWeight.w600,
              color: lim.textDim,
            ).copyWith(letterSpacing: 0.4),
          ),
          if (alignEnd) ...[
            const SizedBox(width: 6),
            Icon(Icons.person_outline, size: 12, color: roleColor),
          ],
        ],
      ),
    );

    final body = _frameBody(context, lim, style, width, roleColor, child);

    return Padding(
      padding: const EdgeInsets.only(
        top: LiminalSpacing.xs,
        bottom: LiminalSpacing.md,
      ),
      child: Column(
        crossAxisAlignment:
            alignEnd ? CrossAxisAlignment.end : CrossAxisAlignment.stretch,
        children: [
          header,
          body,
        ],
      ),
    );
  }

  Widget _frameBody(
    BuildContext context,
    LiminalTokens lim,
    String style,
    double width,
    Color roleColor,
    Widget child,
  ) {
    if (style == 'transcript') {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(12, 8, 10, 8),
        decoration: BoxDecoration(
          border: Border(
            left: BorderSide(color: roleColor.withValues(alpha: 0.75), width: 2),
          ),
        ),
        child: child,
      );
    }

    if (style == 'flat') {
      return Align(
        alignment: alignEnd ? Alignment.centerRight : Alignment.centerLeft,
        child: Container(
          constraints: BoxConstraints(maxWidth: width * 0.94),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: alignEnd
                ? lim.userBubble.withValues(alpha: 0.55)
                : lim.surface.withValues(alpha: 0.35),
            border: Border(
              left: BorderSide(
                color: roleColor.withValues(alpha: alignEnd ? 0.9 : 0.5),
                width: 2,
              ),
            ),
            borderRadius: BorderRadius.circular(
              (lim.radius * 0.35).clamp(0.0, 6.0).toDouble(),
            ),
          ),
          child: child,
        ),
      );
    }

    // bubble
    return Align(
      alignment: alignEnd ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: alignEnd ? width * 0.82 : width * 0.94,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        decoration: BoxDecoration(
          color: alignEnd
              ? lim.userBubble
              : lim.surface.withValues(alpha: 0.55),
          border: Border.all(
            color: alignEnd
                ? lim.accent.withValues(alpha: 0.22)
                : lim.border,
          ),
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(lim.radius),
            topRight: Radius.circular(lim.radius),
            bottomLeft: Radius.circular(alignEnd ? lim.radius : lim.radius * 0.35),
            bottomRight: Radius.circular(alignEnd ? lim.radius * 0.35 : lim.radius),
          ),
          boxShadow: alignEnd
              ? [
                  BoxShadow(
                    color: lim.accent.withValues(alpha: 0.06),
                    blurRadius: 12,
                    offset: const Offset(0, 2),
                  ),
                ]
              : null,
        ),
        child: child,
      ),
    );
  }
}

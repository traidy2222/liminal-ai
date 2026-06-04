import 'package:flutter/material.dart';

import '../layout/liminal_breakpoints.dart';

/// Fills the window with adaptive horizontal inset (no narrow 720px column).
class LiminalPageCanvas extends StatelessWidget {
  const LiminalPageCanvas({
    super.key,
    required this.child,
    this.alignment = Alignment.topCenter,
  });

  final Widget child;
  final Alignment alignment;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth.isFinite
            ? constraints.maxWidth
            : MediaQuery.sizeOf(context).width;
        final maxW = LiminalBreakpoints.contentMaxWidth(width);
        final inset = LiminalBreakpoints.horizontalInset(width);

        return Align(
          alignment: alignment,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: maxW),
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: inset),
              child: child,
            ),
          ),
        );
      },
    );
  }
}

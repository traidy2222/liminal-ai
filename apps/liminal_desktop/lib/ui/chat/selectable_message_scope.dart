import 'package:flutter/material.dart';

/// One drag gesture can select across paragraphs, lists, and code in a message.
class SelectableMessageScope extends StatelessWidget {
  const SelectableMessageScope({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return SelectionArea(child: child);
  }
}

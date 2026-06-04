import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_controller.dart';

/// Root dependency injection for the desktop shell.
class AppScope extends StatelessWidget {
  const AppScope({
    super.key,
    required this.controller,
    required this.child,
  });

  final AppController controller;
  final Widget child;

  static AppController of(BuildContext context) =>
      context.read<AppController>();

  static AppController watch(BuildContext context) =>
      context.watch<AppController>();

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<AppController>.value(
      value: controller,
      child: child,
    );
  }
}

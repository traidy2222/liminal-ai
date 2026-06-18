import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/window_position.dart';
import '../routing/app_router.dart';
import '../state/app_controller.dart';
import '../models/persona_ui_theme.dart';
import '../ui/theme/liminal_fonts.dart';
import '../ui/theme/liminal_theme.dart';
import '../ui/widgets/liminal_error_boundary.dart';
import 'app_scope.dart';

class LiminalApp extends StatefulWidget {
  const LiminalApp({
    super.key,
    required this.controller,
    this.windowPositionManager,
  });

  final AppController controller;
  final WindowPositionManager? windowPositionManager;

  @override
  State<LiminalApp> createState() => _LiminalAppState();
}

class _LiminalAppState extends State<LiminalApp> with WidgetsBindingObserver {
  late final GoRouter _router;
  String? _fontsWarmedKey;

  void _warmFontsIfNeeded(PersonaUiTheme persona) {
    final key = '${persona.fontPair}|${persona.typography}';
    if (_fontsWarmedKey == key) return;
    _fontsWarmedKey = key;
    LiminalFontSet.warmUp(persona);
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _router = createAppRouter(widget.controller);
    _warmFontsIfNeeded(
      widget.controller.config?.resolvedTheme ?? PersonaUiTheme.liminalDefault,
    );
    WidgetsBinding.instance.addPostFrameCallback((_) => widget.controller.boot());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _router.dispose();
    widget.controller.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    widget.controller.onAppLifecycleState(state);
  }

  @override
  Widget build(BuildContext context) {
    return AppScope(
      controller: widget.controller,
      child: LiminalErrorBoundary(
        child: AnimatedBuilder(
          animation: widget.controller,
          builder: (context, _) {
            final persona =
                widget.controller.config?.resolvedTheme ?? PersonaUiTheme.liminalDefault;
            _warmFontsIfNeeded(persona);
            return MaterialApp.router(
              title: 'Liminal',
              debugShowCheckedModeBanner: false,
              theme: buildLiminalTheme(persona: persona),
              routerConfig: _router,
            );
          },
        ),
      ),
    );
  }
}

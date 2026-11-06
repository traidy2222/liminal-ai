import 'package:flutter/material.dart';

import '../layout/liminal_breakpoints.dart';
import '../layout/liminal_spacing.dart';
import 'connection_status_strip.dart';
import 'liminal_background.dart';
import 'liminal_brand.dart';
import 'wake_voice_strip.dart';
import 'browser_dock.dart';
import '../../browser/browser_workspace.dart';

/// Root chrome: branded background behind every screen.
class LiminalShell extends StatelessWidget {
  const LiminalShell({
    super.key,
    required this.body,
    this.appBar,
    this.drawer,
    this.floatingActionButton,
    this.bottomNavigationBar,
    this.showConnectionBanner = true,
  });

  final PreferredSizeWidget? appBar;
  final Widget body;
  final Widget? drawer;
  final Widget? floatingActionButton;
  final Widget? bottomNavigationBar;
  final bool showConnectionBanner;

  @override
  Widget build(BuildContext context) {
    final persistentNavigation =
        drawer != null && MediaQuery.sizeOf(context).width >= 1100;
    final scaffold = Scaffold(
      backgroundColor: Colors.transparent,
      appBar: appBar,
      drawer: persistentNavigation ? null : drawer,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (showConnectionBanner) const ConnectionStatusStrip(),
          const WakeVoiceStrip(),
          const BrowserWorkspaceStrip(),
          Expanded(
            child: ListenableBuilder(
              listenable: BrowserWorkspace.instance,
              builder: (context, _) {
                return LayoutBuilder(
                  builder: (context, constraints) {
                    final show = BrowserWorkspace.instance.showPanel;
                    return Row(
                      children: [
                        if (!show || constraints.maxWidth >= 800)
                          Expanded(child: body),
                        if (show)
                          SizedBox(
                            width: constraints.maxWidth < 800
                                ? constraints.maxWidth
                                : (constraints.maxWidth * 0.48).clamp(
                                    400.0,
                                    900.0,
                                  ),
                            child: const BrowserDock(),
                          ),
                      ],
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
      floatingActionButton: floatingActionButton,
      bottomNavigationBar: bottomNavigationBar,
    );
    return LiminalBackground(
      child: persistentNavigation
          ? Row(
              children: [
                SizedBox(width: 272, child: drawer),
                Expanded(child: scaffold),
              ],
            )
          : scaffold,
    );
  }
}

/// Centered onboarding / setup card on the HUD background.
class LiminalOnboardingPage extends StatelessWidget {
  const LiminalOnboardingPage({
    super.key,
    required this.title,
    required this.subtitle,
    required this.child,
  });

  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return LiminalBackground(
      child: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 28),
            child: LayoutBuilder(
              builder: (context, constraints) {
                final w = constraints.maxWidth;
                final cardW = w >= LiminalBreakpoints.medium
                    ? LiminalSpacing.maxFormWidth
                    : (w - 40).clamp(280.0, LiminalSpacing.maxFormWidth);
                return Align(
                  alignment: Alignment.topCenter,
                  child: ConstrainedBox(
                    constraints: BoxConstraints(maxWidth: cardW),
                    child: Card(
                      margin: EdgeInsets.zero,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(32, 32, 32, 36),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const LiminalBrandMark(compact: true),
                            const SizedBox(height: 24),
                            Text(
                              title,
                              style: Theme.of(context).textTheme.headlineMedium,
                            ),
                            const SizedBox(height: 10),
                            Text(
                              subtitle,
                              style: Theme.of(context).textTheme.bodyMedium
                                  ?.copyWith(
                                    color: Theme.of(context)
                                        .colorScheme
                                        .onSurface
                                        .withValues(alpha: 0.7),
                                    height: 1.4,
                                  ),
                            ),
                            const SizedBox(height: 28),
                            child,
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

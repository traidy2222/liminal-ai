import 'package:go_router/go_router.dart';

import '../app/app_scope.dart';
import '../state/app_controller.dart';
import '../ui/screens/boot_screens.dart';
import '../ui/screens/home_screen.dart';
import '../ui/screens/persona_bootstrap_screen.dart';
import '../ui/screens/settings_screen.dart';
import '../ui/screens/setup_screen.dart';
import '../ui/screens/integrations_screen.dart';
import '../ui/screens/vireon_hub_screen.dart';
import '../ui/theme/liminal_theme_extension.dart';
import '../ui/widgets/liminal_background.dart';
import '../ui/widgets/liminal_brand.dart';
import 'routes.dart';

GoRouter createAppRouter(AppController controller) {
  return GoRouter(
    initialLocation: AppRoutes.boot,
    refreshListenable: controller,
    errorBuilder: (context, state) => const _RouterErrorScreen(),
    redirect: (context, state) {
      final host = AppScope.of(context);
      final loc = state.matchedLocation;

      if (host.phase == ConnectionPhase.booting) {
        return loc == AppRoutes.boot ? null : AppRoutes.boot;
      }
      if (host.phase == ConnectionPhase.error) {
        return loc == AppRoutes.error ? null : AppRoutes.error;
      }
      if (host.phase != ConnectionPhase.connected) {
        return loc == AppRoutes.boot ? null : AppRoutes.boot;
      }

      if (host.sidecarInitError != null && host.sidecarInitError!.isNotEmpty) {
        return loc == AppRoutes.configError ? null : AppRoutes.configError;
      }
      if (!host.sidecarReady) {
        return loc == AppRoutes.starting ? null : AppRoutes.starting;
      }
      if (host.config == null) {
        return loc == AppRoutes.configError ? null : AppRoutes.configError;
      }
      if (host.needsProviderSetup) {
        return loc == AppRoutes.setup ? null : AppRoutes.setup;
      }
      if (host.needsPersonaBootstrap) {
        return loc == AppRoutes.persona ? null : AppRoutes.persona;
      }

      if (loc == AppRoutes.boot ||
          loc == AppRoutes.error ||
          loc == AppRoutes.starting ||
          loc == AppRoutes.configError ||
          loc == AppRoutes.setup ||
          loc == AppRoutes.persona) {
        return AppRoutes.hub;
      }
      if (host.inChatWorkspace && loc == AppRoutes.hub) {
        return AppRoutes.chat;
      }
      return null;
    },
    routes: [
      GoRoute(
        path: AppRoutes.boot,
        builder: (_, __) => const BootScreen(),
      ),
      GoRoute(
        path: AppRoutes.error,
        builder: (_, __) => const ErrorBootScreen(),
      ),
      GoRoute(
        path: AppRoutes.starting,
        builder: (_, __) => const StartingSidecarScreen(),
      ),
      GoRoute(
        path: AppRoutes.configError,
        builder: (_, __) => const ConfigErrorScreen(),
      ),
      GoRoute(
        path: AppRoutes.setup,
        builder: (_, __) => const SetupScreen(),
      ),
      GoRoute(
        path: AppRoutes.persona,
        builder: (_, __) => const PersonaBootstrapScreen(),
      ),
      GoRoute(
        path: AppRoutes.hub,
        builder: (_, __) => const VireonHubScreen(),
      ),
      GoRoute(
        path: AppRoutes.chat,
        builder: (_, __) => const HomeScreen(),
      ),
      GoRoute(
        path: AppRoutes.settings,
        builder: (_, __) => const SettingsScreen(),
      ),
      GoRoute(
        path: AppRoutes.integrations,
        builder: (_, __) => const IntegrationsScreen(),
      ),
    ],
  );
}

class _RouterErrorScreen extends StatelessWidget {
  const _RouterErrorScreen();

  @override
  Widget build(BuildContext context) {
    final lim = LiminalThemeExtension.of(context).tokens;
    return LiminalBackground(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.route_outlined,
                      size: 48,
                      color: lim.warn,
                    ),
                    const SizedBox(height: 16),
                    const LiminalBrandMark(compact: true),
                    const SizedBox(height: 16),
                    Text(
                      'Page not found',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'The page you were looking for doesn\'t exist or was moved.',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: lim.textMuted,
                          ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: () => context.go(AppRoutes.hub),
                      child: const Text('Go home'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

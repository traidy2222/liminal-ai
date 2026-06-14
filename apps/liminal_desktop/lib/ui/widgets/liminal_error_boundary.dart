import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;

import '../theme/liminal_theme_extension.dart';
import 'liminal_brand.dart';
import 'liminal_background.dart';

typedef ErrorBoundaryCallback = void Function(Object error, StackTrace stack);

class LiminalErrorBoundary extends StatefulWidget {
  const LiminalErrorBoundary({
    super.key,
    required this.child,
    this.onError,
    this.showDetails = kDebugMode,
  });

  final Widget child;
  final ErrorBoundaryCallback? onError;
  final bool showDetails;

  @override
  State<LiminalErrorBoundary> createState() => _LiminalErrorBoundaryState();
}

class _LiminalErrorBoundaryState extends State<LiminalErrorBoundary> {
  Object? _error;
  StackTrace? _stack;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _error = null;
  }

  void _reportError(Object error, StackTrace stack) {
    _appendDesktopLog('LiminalErrorBoundary: $error\n$stack');
    widget.onError?.call(error, stack);
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return _ErrorFallbackScreen(
        error: _error!,
        stack: _stack,
        showDetails: widget.showDetails,
        onRetry: () {
          setState(() {
            _error = null;
            _stack = null;
          });
        },
      );
    }

    return _ErrorBoundaryScope(
      onError: (error, stack) {
        if (!mounted) return;
        _reportError(error, stack);
        setState(() {
          _error = error;
          _stack = stack;
        });
      },
      child: widget.child,
    );
  }
}

class _ErrorBoundaryScope extends StatefulWidget {
  const _ErrorBoundaryScope({
    required this.onError,
    required this.child,
  });

  final ErrorBoundaryCallback onError;
  final Widget child;

  @override
  State<_ErrorBoundaryScope> createState() => _ErrorBoundaryScopeState();

  static _ErrorBoundaryScopeState? maybeOf(BuildContext context) {
    return context.findAncestorStateOfType<_ErrorBoundaryScopeState>();
  }
}

class _ErrorBoundaryScopeState extends State<_ErrorBoundaryScope> {
  void report(Object error, StackTrace stack) {
    widget.onError(error, stack);
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

class _ErrorFallbackScreen extends StatelessWidget {
  const _ErrorFallbackScreen({
    required this.error,
    this.stack,
    required this.showDetails,
    required this.onRetry,
  });

  final Object error;
  final StackTrace? stack;
  final bool showDetails;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalThemeExtension.of(context).tokens;
    return LiminalBackground(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.error_outline_rounded,
                      size: 48,
                      color: lim.danger,
                    ),
                    const SizedBox(height: 16),
                    const LiminalBrandMark(compact: true),
                    const SizedBox(height: 16),
                    Text(
                      'Something went wrong',
                      style: Theme.of(context).textTheme.titleMedium,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'An unexpected error occurred. You can try again or check the logs.',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: lim.textMuted,
                          ),
                      textAlign: TextAlign.center,
                    ),
                    if (showDetails) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: lim.codeBackground,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: SelectableText(
                            _formatError(error, stack),
                            style: TextStyle(
                              fontFamily: lim.fontFamilyMono,
                              fontSize: 12,
                              color: lim.danger,
                            ),
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: 20),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        OutlinedButton(
                          onPressed: _openLogFolder,
                          child: const Text('View logs'),
                        ),
                        const SizedBox(width: 12),
                        FilledButton(
                          onPressed: onRetry,
                          child: const Text('Retry'),
                        ),
                      ],
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

  String _formatError(Object error, StackTrace? stack) {
    final buffer = StringBuffer();
    buffer.writeln(error.toString());
    if (stack != null) {
      final lines = stack.toString().split('\n').take(8);
      for (final line in lines) {
        buffer.writeln(line);
      }
    }
    return buffer.toString();
  }

  void _openLogFolder() {
    final home = Platform.environment['USERPROFILE'] ??
        Platform.environment['HOME'] ??
        Directory.current.path;
    final logPath = p.join(home, '.liminal');
    try {
      Process.start('explorer', [logPath]);
    } catch (_) {}
  }
}

void _appendDesktopLog(String line) {
  try {
    final home = Platform.environment['USERPROFILE'] ??
        Platform.environment['HOME'] ??
        Directory.current.path;
    final file = File(p.join(home, '.liminal', 'desktop.log'));
    file.parent.createSync(recursive: true);
    final stamp = DateTime.now().toIso8601String();
    file.writeAsStringSync('[$stamp] $line\n', mode: FileMode.append);
  } catch (_) {}
}

class LiminalErrorReporter {
  LiminalErrorReporter._();

  static final LiminalErrorReporter instance = LiminalErrorReporter._();

  void reportFlutterError(FlutterErrorDetails details) {
    _appendDesktopLog(
      'FlutterError: ${details.exceptionAsString()}\n${details.stack}',
    );
  }

  void reportPlatformError(Object error, StackTrace stack) {
    _appendDesktopLog('Uncaught: $error\n$stack');
  }

  void reportWidgetError(BuildContext context, Object error, StackTrace stack) {
    final scope = _ErrorBoundaryScope.maybeOf(context);
    scope?.report(error, stack);
  }
}

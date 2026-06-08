import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../models/browser_view_state.dart';
import '../layout/liminal_spacing.dart';
import '../rich_message/asset_url_resolver.dart';
import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';

/// Collapsible in-app browser panel — renders Playwright viewport previews from the sidecar.
class BrowserDock extends StatefulWidget {
  const BrowserDock({
    super.key,
    required this.view,
    required this.expanded,
    required this.onToggleExpanded,
    this.width = 420,
    this.collapsedWidth = 44,
  });

  final BrowserViewState view;
  final bool expanded;
  final VoidCallback onToggleExpanded;
  final double width;
  final double collapsedWidth;

  @override
  State<BrowserDock> createState() => _BrowserDockState();
}

class _BrowserDockState extends State<BrowserDock> {
  Uint8List? _frameBytes;
  String? _loadedKey;
  String? _loadError;
  int _fetchGeneration = 0;

  @override
  void initState() {
    super.initState();
    assetUrlResolver.addListener(_onAssetResolverChanged);
    _scheduleFetch(widget.view);
  }

  @override
  void dispose() {
    assetUrlResolver.removeListener(_onAssetResolverChanged);
    super.dispose();
  }

  void _onAssetResolverChanged() {
    _loadedKey = null;
    _scheduleFetch(widget.view);
  }

  @override
  void didUpdateWidget(covariant BrowserDock oldWidget) {
    super.didUpdateWidget(oldWidget);
    _scheduleFetch(widget.view);
  }

  List<String> _previewUrls(BrowserViewState view) {
    final urls = <String>[];
    final preview = assetUrlResolver.resolveBrowserPreview(
      view.sessionId,
      view.updatedAt,
    );
    if (preview != null) urls.add(preview);

    final rel = view.imageRelPath;
    if (rel != null && rel.trim().isNotEmpty) {
      final media = assetUrlResolver.resolveImageSrc(rel);
      if (media != null && !urls.contains(media)) urls.add(media);
    }
    return urls;
  }

  void _scheduleFetch(BrowserViewState view) {
    if (!view.open) return;

    if (view.sessionId.isEmpty) {
      setState(() {
        _loadError = null;
        _frameBytes = null;
      });
      return;
    }

    final urls = _previewUrls(view);
    if (urls.isEmpty) {
      setState(() => _loadError = 'Sidecar preview URL unavailable');
      return;
    }

    final key = urls.join('|');
    if (key == _loadedKey && _frameBytes != null) return;

    final gen = ++_fetchGeneration;
    unawaited(_fetchPreview(urls, key, gen));
  }

  Future<void> _fetchPreview(List<String> urls, String key, int generation) async {
    for (final url in urls) {
      for (var attempt = 0; attempt < 8; attempt++) {
        if (!mounted || generation != _fetchGeneration) return;
        HttpClient? client;
        try {
          client = HttpClient();
          final request = await client.getUrl(Uri.parse(url));
          final response = await request.close();
          if (response.statusCode == 404 && attempt < 7) {
            await Future<void>.delayed(Duration(milliseconds: 200 * (attempt + 1)));
            continue;
          }
          if (response.statusCode != 200) {
            break;
          }
          final bytes = await consolidateHttpClientResponseBytes(response);
          if (!mounted || generation != _fetchGeneration) return;
          if (bytes.length > 64) {
            setState(() {
              _loadedKey = key;
              _frameBytes = bytes;
              _loadError = null;
            });
            return;
          }
        } catch (_) {
          if (attempt >= 7) break;
          await Future<void>.delayed(Duration(milliseconds: 220 * (attempt + 1)));
        } finally {
          client?.close(force: true);
        }
      }
    }

    if (!mounted || generation != _fetchGeneration) return;
    setState(() => _loadError = 'Could not load browser preview');
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final theme = Theme.of(context);

    return LayoutBuilder(
      builder: (context, constraints) {
        final maxW = constraints.maxWidth;
        final maxH = constraints.maxHeight;
        if (!maxW.isFinite || !maxH.isFinite || maxW <= 0 || maxH <= 0) {
          return const SizedBox.shrink();
        }

        if (!widget.expanded) {
          return SizedBox(
            width: widget.collapsedWidth.clamp(0, maxW),
            height: maxH,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: lim.panel.withValues(alpha: 0.98),
                border: Border(left: BorderSide(color: lim.border)),
              ),
              child: _collapsedRail(context, lim),
            ),
          );
        }

        return DecoratedBox(
          decoration: BoxDecoration(
            color: lim.panel.withValues(alpha: 0.98),
            border: Border(left: BorderSide(color: lim.border)),
          ),
          child: SizedBox(
            width: maxW,
            height: maxH,
            child: _expandedBody(context, lim, theme),
          ),
        );
      },
    );
  }

  Widget _collapsedRail(BuildContext context, LiminalTokens lim) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: widget.onToggleExpanded,
        child: Tooltip(
          message: 'Expand browser',
          child: Center(
            child: RotatedBox(
              quarterTurns: 1,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.language, color: lim.accent, size: 18),
                  const SizedBox(width: 6),
                  Text(
                    'Browser',
                    style: TextStyle(
                      color: lim.accent,
                      fontSize: 11,
                      letterSpacing: 0.6,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _expandedBody(BuildContext context, LiminalTokens lim, ThemeData theme) {
    final view = widget.view;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Material(
          color: lim.panel.withValues(alpha: 0.95),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: LiminalSpacing.sm,
              vertical: LiminalSpacing.xs,
            ),
            child: Row(
              children: [
                Icon(Icons.language, color: lim.accent, size: 18),
                const SizedBox(width: LiminalSpacing.xs),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        view.title?.trim().isNotEmpty == true ? view.title! : 'Agent browser',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleSmall?.copyWith(color: lim.text),
                      ),
                      Text(
                        view.url.isNotEmpty ? view.url : 'Starting…',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall?.copyWith(color: lim.textMuted),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Refresh preview',
                  icon: Icon(Icons.refresh, color: lim.textMuted, size: 20),
                  onPressed: () {
                    _loadedKey = null;
                    _scheduleFetch(view);
                  },
                ),
                IconButton(
                  tooltip: 'Collapse browser',
                  icon: Icon(Icons.chevron_right, color: lim.textMuted),
                  onPressed: widget.onToggleExpanded,
                ),
              ],
            ),
          ),
        ),
        Divider(height: 1, color: lim.border),
        Expanded(child: _previewBody(context, lim, theme)),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            LiminalSpacing.sm,
            LiminalSpacing.xs,
            LiminalSpacing.sm,
            LiminalSpacing.sm,
          ),
          child: Text(
            'Agent-controlled browser — updates after each browser tool step.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: lim.textMuted,
              height: 1.35,
            ),
          ),
        ),
      ],
    );
  }

  Widget _previewBody(BuildContext context, LiminalTokens lim, ThemeData theme) {
    if (_frameBytes != null) {
      return InteractiveViewer(
        minScale: 0.5,
        maxScale: 2.5,
        child: Center(
          child: Image.memory(
            _frameBytes!,
            fit: BoxFit.contain,
            gaplessPlayback: true,
          ),
        ),
      );
    }

    if (_loadError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(LiminalSpacing.md),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _loadError!,
                style: TextStyle(color: theme.colorScheme.error),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: LiminalSpacing.sm),
              TextButton(
                onPressed: () {
                  _loadedKey = null;
                  _scheduleFetch(widget.view);
                },
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }

    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: LiminalSpacing.sm),
          Text(
            widget.view.sessionId.isEmpty
                ? 'Starting browser session…'
                : 'Loading browser preview…',
            style: theme.textTheme.bodyMedium?.copyWith(color: lim.textMuted),
          ),
        ],
      ),
    );
  }
}

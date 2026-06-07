import 'package:flutter/material.dart';

import '../../models/liminal_app_spec.dart';
import 'widget_shell.dart';

/// Native weather card for a liminal desktop app window.
class WeatherApp extends StatelessWidget {
  const WeatherApp({
    super.key,
    required this.spec,
    required this.cache,
    required this.accent,
    this.onRefresh,
    this.onHide,
  });

  final LiminalAppSpec spec;
  final AppCacheEntry? cache;
  final Color accent;
  final VoidCallback? onRefresh;
  final VoidCallback? onHide;

  @override
  Widget build(BuildContext context) {
    final body = _buildBody(context);
    if (spec.isWidgetMode) {
      return WidgetShell(
        title: spec.title,
        accent: accent,
        onRefresh: onRefresh,
        onHide: onHide,
        child: body,
      );
    }
    return _windowShell(context, body);
  }

  Widget _buildBody(BuildContext context) {
    final location = spec.props['location'] as String? ?? spec.title;
    final theme = Theme.of(context);

    if (cache == null) {
      return const Center(child: CircularProgressIndicator());
    }

    if (!cache!.ok) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.cloud_off, size: 36, color: accent.withValues(alpha: 0.7)),
              const SizedBox(height: 10),
              Text(
                cache!.error ?? 'Weather unavailable',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium,
              ),
              if (onRefresh != null) ...[
                const SizedBox(height: 12),
                FilledButton.tonal(onPressed: onRefresh, child: const Text('Retry')),
              ],
            ],
          ),
        ),
      );
    }

    final data = cache!.data;
    if (data == null) {
      return const Center(child: Text('No weather data yet.'));
    }

    final resolved = data['resolved_location'];
    final placeName = resolved is Map
        ? (resolved['name'] as String? ?? location)
        : location;
    final conditions = data['conditions'] as String? ?? '—';
    final temp = data['temperature'];
    final tempValue = temp is Map ? temp['value'] : null;
    final tempUnits = temp is Map ? (temp['units'] as String? ?? 'C') : 'C';
    final wind = data['wind'];
    final windSpeed = wind is Map ? wind['speed'] : null;
    final windUnits = wind is Map ? (wind['speed_units'] as String? ?? 'km/h') : 'km/h';
    final observedAt = data['observed_at'] as String?;
    final freshness = data['freshness_minutes'];
    final note = data['uncertainty_note'] as String?;
    final isLive = data['is_live'] as bool? ?? false;

    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            placeName,
            style: theme.textTheme.labelLarge?.copyWith(
              color: accent,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            conditions,
            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 6),
          if (tempValue != null)
            Text(
              '${_formatNum(tempValue)}°$tempUnits',
              style: theme.textTheme.displaySmall?.copyWith(
                fontWeight: FontWeight.w300,
                height: 1,
              ),
            ),
          const SizedBox(height: 10),
          if (windSpeed != null)
            _row(context, Icons.air, 'Wind', '${_formatNum(windSpeed)} $windUnits'),
          const SizedBox(height: 4),
          _row(
            context,
            Icons.schedule,
            'As of',
            observedAt?.isNotEmpty == true ? observedAt! : 'unknown',
          ),
          if (freshness != null) ...[
            const SizedBox(height: 4),
            Text(
              isLive ? 'Live · $freshness min ago' : 'Estimate · $freshness min ago',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.65),
              ),
            ),
          ],
          if (note != null && note.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              note,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.55),
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _windowShell(BuildContext context, Widget body) {
    return Scaffold(
      appBar: AppBar(
        title: Text(spec.title),
        backgroundColor: accent.withValues(alpha: 0.12),
        foregroundColor: Theme.of(context).colorScheme.onSurface,
        elevation: 0,
      ),
      body: body,
    );
  }

  Widget _row(BuildContext context, IconData icon, String label, String value) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Icon(icon, size: 16, color: accent.withValues(alpha: 0.8)),
        const SizedBox(width: 6),
        Text('$label: ', style: theme.textTheme.bodySmall),
        Expanded(
          child: Text(
            value,
            style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w500),
          ),
        ),
      ],
    );
  }

  String _formatNum(dynamic v) {
    if (v is num) {
      return v == v.roundToDouble() ? v.round().toString() : v.toStringAsFixed(1);
    }
    return v?.toString() ?? '—';
  }
}

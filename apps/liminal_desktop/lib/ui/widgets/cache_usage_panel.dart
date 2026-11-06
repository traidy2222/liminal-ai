import 'package:flutter/material.dart';
import '../../app/app_scope.dart';

class CacheUsagePanel extends StatefulWidget {
  const CacheUsagePanel({super.key});
  @override
  State<CacheUsagePanel> createState() => _CacheUsagePanelState();
}

class _CacheUsagePanelState extends State<CacheUsagePanel> {
  Map<String, dynamic>? _stats;
  bool _loading = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  Future<void> _load() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final stats = await AppScope.of(context).loadCacheStats();
      if (mounted)
        setState(() {
          _stats = stats;
          _error = stats == null ? 'Cache statistics unavailable' : null;
        });
    } catch (_) {
      if (mounted) setState(() => _error = 'Cache statistics unavailable');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _percent(dynamic value) =>
      value is num ? '${(value * 100).toStringAsFixed(1)}%' : 'Not reported';
  @override
  Widget build(BuildContext context) {
    final agent = _stats?['agent'] as Map?;
    final recent = _stats?['last50'] as Map?;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Prompt cache',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                IconButton(
                  tooltip: 'Refresh cache statistics',
                  onPressed: _loading ? null : _load,
                  icon: const Icon(Icons.refresh),
                ),
              ],
            ),
            if (_error != null)
              Text(_error!)
            else if (agent == null || agent['requests'] == 0)
              const Text(
                'No measured responses yet. Statistics appear as you use Liminal.',
              )
            else ...[
              Text(
                '${_percent(agent['cacheHitRate'])} cached-token share where usage is known',
              ),
              Text(
                '${agent['cachedTokens']} cached / ${agent['inputTokens']} covered input tokens · ${agent['requests']} measured responses',
              ),
              const SizedBox(height: 8),
              Text(
                'Last 50: ${_percent(recent?['cacheHitRate'])} tokens cached · ${_percent(recent?['requestHitRate'])} requests with a hit',
              ),
              Text(
                'Cache data covers ${_percent(agent['coverage'])} of responses and ${_percent(agent['inputTokenCoverage'])} of reported input tokens. Missing counts are not treated as misses.',
              ),
              const SizedBox(height: 8),
              Text(
                'Providers observed: ${(_stats?['byProvider'] as Map?)?.keys.join(', ') ?? 'Not reported'}',
              ),
            ],
            const SizedBox(height: 8),
            Text(
              'Local telemetry only. Main-agent rates are separate from background helpers and chat titles. Window: up to 5,000 measured responses.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

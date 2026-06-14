/// Live context window usage from harness `context_snapshot` / `turn_end`.
class ContextSnapshot {
  const ContextSnapshot({
    required this.tokenCount,
    required this.maxTokens,
    required this.usageFraction,
    required this.masked,
    this.toolTokenCount,
    this.requestTokenCount,
    this.requestUsageFraction,
    this.contextTier,
    this.modelSlug,
  });

  final int tokenCount;
  final int maxTokens;
  final double usageFraction;
  final bool masked;
  final int? toolTokenCount;
  final int? requestTokenCount;
  final double? requestUsageFraction;
  final String? contextTier;
  final String? modelSlug;

  double get displayFraction => requestUsageFraction ?? usageFraction;

  int get displayPercent => (displayFraction * 100).round().clamp(0, 100);

  static ContextSnapshot? fromWire(Map<String, dynamic>? data) {
    if (data == null) return null;
    final usage = (data['usageFraction'] as num?)?.toDouble();
    final max = (data['maxTokens'] as num?)?.toInt();
    final count = (data['tokenCount'] as num?)?.toInt();
    if (usage == null || max == null || count == null) return null;
    return ContextSnapshot(
      tokenCount: count,
      maxTokens: max,
      usageFraction: usage,
      masked: data['masked'] == true,
      toolTokenCount: (data['toolTokenCount'] as num?)?.toInt(),
      requestTokenCount: (data['requestTokenCount'] as num?)?.toInt(),
      requestUsageFraction: (data['requestUsageFraction'] as num?)?.toDouble(),
      contextTier: data['contextTier'] as String?,
      modelSlug: data['modelSlug'] as String?,
    );
  }
}

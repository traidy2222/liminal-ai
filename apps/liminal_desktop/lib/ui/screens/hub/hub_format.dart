/// Human-readable relative timestamps for hub chat rows.
String hubRelativeTime(int updatedAtMs) {
  if (updatedAtMs <= 0) return '';
  final dt = DateTime.fromMillisecondsSinceEpoch(updatedAtMs);
  final diff = DateTime.now().difference(dt);
  if (diff.inSeconds < 45) return 'Just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  if (diff.inDays < 7) return '${diff.inDays}d ago';
  return '${dt.month}/${dt.day}';
}

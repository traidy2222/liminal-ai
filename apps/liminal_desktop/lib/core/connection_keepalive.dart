/// Backoff delays for sidecar WebSocket reconnect (mirrors web `useSSE` caps).
int reconnectDelayMs(int attempt) {
  final capped = attempt.clamp(0, 6);
  final base = (300 * (1 << capped)).clamp(300, 8000);
  return base;
}

/// Health ping interval while connected.
const Duration connectionPingInterval = Duration(seconds: 20);

/// Miss this many consecutive pings before forcing reconnect.
const int connectionPingMissLimit = 2;

/// Per-ping command timeout.
const Duration connectionPingTimeout = Duration(seconds: 5);

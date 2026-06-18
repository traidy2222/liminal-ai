/// Sidecar + WebSocket lifecycle for the desktop shell.
enum ConnectionPhase {
  idle,
  booting,
  connected,
  /// Recovering from a dropped loopback WebSocket without leaving the current screen.
  reconnecting,
  error,
}

/// @deprecated Use [ConnectionPhase] — kept for gradual migration.
typedef AppConnectionPhase = ConnectionPhase;

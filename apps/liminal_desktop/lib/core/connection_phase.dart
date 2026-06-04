/// Sidecar + WebSocket lifecycle for the desktop shell.
enum ConnectionPhase {
  idle,
  booting,
  connected,
  error,
}

/// @deprecated Use [ConnectionPhase] — kept for gradual migration.
typedef AppConnectionPhase = ConnectionPhase;

/// One interactive shell tab in the per-chat terminal dock.
class TerminalTabState {
  const TerminalTabState({
    required this.sessionId,
    required this.embedUrl,
    required this.cwd,
    required this.label,
    required this.source,
  });

  final String sessionId;
  final String embedUrl;
  final String cwd;
  final String label;
  /// `agent` | `user`
  final String source;

  TerminalTabState copyWith({
    String? embedUrl,
    String? cwd,
    String? label,
    String? source,
  }) {
    return TerminalTabState(
      sessionId: sessionId,
      embedUrl: embedUrl ?? this.embedUrl,
      cwd: cwd ?? this.cwd,
      label: label ?? this.label,
      source: source ?? this.source,
    );
  }
}

/// Multi-tab terminal panel below the composer.
class TerminalPanelState {
  const TerminalPanelState({
    required this.tabs,
    required this.activeSessionId,
    this.open = true,
  });

  final List<TerminalTabState> tabs;
  final String activeSessionId;
  final bool open;

  TerminalTabState? get activeTab {
    for (final t in tabs) {
      if (t.sessionId == activeSessionId) return t;
    }
    return tabs.isNotEmpty ? tabs.last : null;
  }

  bool get hasTabs => tabs.isNotEmpty;

  TerminalPanelState copyWith({
    List<TerminalTabState>? tabs,
    String? activeSessionId,
    bool? open,
  }) {
    return TerminalPanelState(
      tabs: tabs ?? this.tabs,
      activeSessionId: activeSessionId ?? this.activeSessionId,
      open: open ?? this.open,
    );
  }
}

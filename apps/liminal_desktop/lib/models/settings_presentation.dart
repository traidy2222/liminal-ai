// Presentation only; advanced fields remain searchable and editable.
const everydaySettings = <String, ({String label, String description})>{
  'AGENT_TTS_MODEL': (
    label: 'Speech model',
    description: 'Choose JARVIS Warm for a warmer voice at its original pitch, running on this computer after a one-time download.'
  ),
  'AGENT_FAST_MODEL': (
    label: "Background model",
    description: "Model used for quick background tasks."
  ),
  'AGENT_EFFORT': (
    label: "Response detail",
    description: "Choose how much detail to include in responses."
  ),
  'AGENT_UI_VERBOSITY': (
    label: "Activity detail",
    description: "Choose how much agent activity appears in conversations."
  ),
  'AGENT_SESSION_GREET': (
    label: "Opening greeting",
    description: "Let your agent greet you in a new conversation."
  ),
  'AGENT_LOCATION': (
    label: "Location",
    description: "Optional location context for local questions."
  ),
  'AGENT_TTS_ENABLED': (
    label: "Spoken responses",
    description: "Read responses aloud when voice is available."
  ),
  'AGENT_MEMORY_GRAPH': (
    label: "Connected memories",
    description: "Link related memories to help recall useful context."
  ),
  'AGENT_MEMORY_AUTO_EXTRACT': (
    label: "Remember useful details",
    description: "Save useful information from completed conversations."
  ),
  'AGENT_VAULT_PATH': (
    label: "Notes folder",
    description: "Choose the folder used for your knowledge vault."
  ),
  'AGENT_OBSIDIAN_DISCOVER': (
    label: "Find Obsidian vaults",
    description: "Look for an existing Obsidian vault on this device."
  ),
  'AGENT_AUTO_DREAM': (
    label: "Background memory review",
    description: "Review past sessions while idle to consolidate memory."
  ),
  'AGENT_APPROVAL_TIMEOUT_MS': (
    label: "Approval timeout",
    description:
        "How long to wait for an approval before declining it, in milliseconds."
  ),
  'AGENT_SANDBOX': (
    label: "Workspace sandbox",
    description: "Limit file access to the configured workspace."
  ),
  'AGENT_BROWSER': (
    label: "Browser access",
    description: "Allow browser tools when a task needs them."
  ),
  'AGENT_WEB_READABILITY': (
    label: "Readable web pages",
    description: "Extract the main content when reading a web page."
  ),
  'AGENT_DOC_ENGINE': (
    label: "Document creation",
    description: "Enable tools for documents, slides, and PDFs."
  ),
};
String settingsCategory(String tabId, [String? key]) {
  if (key == 'AGENT_AUTO_DREAM') return 'memory_vault';
  if (key == 'AGENT_EFFORT' || key == 'AGENT_TTS_ENABLED' || key == 'AGENT_TTS_MODEL') return 'session_ui';
  if (key == 'AGENT_BROWSER') return 'safety';
  return const ['models_api', 'session_ui', 'memory_vault', 'safety']
          .contains(tabId)
      ? tabId
      : 'advanced';
}

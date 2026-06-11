class ComposerSlashOutcome {
  const ComposerSlashOutcome._({
    required this.handled,
    this.message,
    this.clearInput = false,
    this.sendText,
    this.workflowPreset,
    this.attachPath,
    this.abortTurn = false,
  });

  final bool handled;
  final String? message;
  final bool clearInput;
  final String? sendText;
  final String? workflowPreset;
  final String? attachPath;
  final bool abortTurn;

  factory ComposerSlashOutcome.message(String message, {bool clearInput = true}) =>
      ComposerSlashOutcome._(handled: true, message: message, clearInput: clearInput);

  factory ComposerSlashOutcome.send({
    required String text,
    String? workflowPreset,
    bool clearInput = true,
  }) =>
      ComposerSlashOutcome._(
        handled: true,
        sendText: text,
        workflowPreset: workflowPreset,
        clearInput: clearInput,
      );

  factory ComposerSlashOutcome.attachPath(String path) =>
      ComposerSlashOutcome._(handled: true, attachPath: path, clearInput: true);

  factory ComposerSlashOutcome.abort() =>
      const ComposerSlashOutcome._(handled: true, abortTurn: true, clearInput: true);

  static const notHandled = ComposerSlashOutcome._(handled: false);
}

import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/ui/widgets/composer_slash.dart';

void main() {
  test('listSlashCompletions suggests connect and xero', () {
    final cmds = listSlashCompletions('/con', 4);
    expect(cmds.any((c) => c.label == '/connect'), isTrue);

    final providers = listSlashCompletions('/connect xe', 10);
    expect(providers.any((c) => c.label == 'xero'), isTrue);
  });

  test('parseComposerSlashSubmit parses receipt note', () {
    final parsed = parseComposerSlashSubmit('/receipt fuel');
    expect(parsed?.kind, SlashCommandKind.receiptWorkflow);
    expect(parsed?.note, 'fuel');
  });

  test('applySlashCompletion expands command', () {
    final next = applySlashCompletion(
      '/con',
      4,
      const SlashCompletionItem(
        label: '/connect',
        insert: 'connect',
        kind: 'command',
      ),
    );
    expect(next.text, '/connect ');
  });
}

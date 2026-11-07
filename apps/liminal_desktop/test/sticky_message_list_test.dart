import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/state/message_models.dart';
import '../lib/ui/widgets/sticky_message_list.dart';

void main() {
  testWidgets(
    'history, in-place streaming and pane reflow keep following the end',
    (tester) async {
      final tail = AssistantMessage(text: 'Latest reply.');
      final messages = <MessageEntry>[
        for (var i = 0; i < 25; i++)
          UserMessage('Earlier message $i. ${'Useful context. ' * 8}'),
        tail,
      ];
      Future<void> show(double width) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Align(
                alignment: Alignment.topLeft,
                child: SizedBox(
                  width: width,
                  height: 300,
                  child: StickyMessageList(
                    messages: messages,
                    showRawHarness: false,
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
      }

      ScrollPosition position() => tester
          .state<ScrollableState>(
            find
                .descendant(
                  of: find.byType(StickyMessageList),
                  matching: find.byType(Scrollable),
                )
                .first,
          )
          .position;
      await show(600);
      expect(position().extentAfter, lessThan(2));
      tail.text += '\n\n${'New streamed content. ' * 100}';
      await show(600);
      expect(position().extentAfter, lessThan(2));
      await show(320);
      expect(position().extentAfter, lessThan(2));
      await tester.drag(find.byType(ListView).first, const Offset(0, 260));
      await tester.pumpAndSettle();
      final readingOffset = position().pixels;
      expect(position().extentAfter, greaterThan(120));
      tail.text += '\n\nMore text arrived while reading earlier messages.';
      await show(320);
      expect(position().pixels, closeTo(readingOffset, 1));
    },
  );
}

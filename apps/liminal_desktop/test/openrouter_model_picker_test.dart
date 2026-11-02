import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/models/openrouter_catalog.dart';
import 'package:liminal_desktop/ui/theme/liminal_theme.dart';
import 'package:liminal_desktop/ui/widgets/openrouter_model_picker.dart';
void main() {
  testWidgets('catalog search selects one model and blocks routers in single mode', (tester) async {
    tester.view.devicePixelRatio = 1; tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final changes = <String>[];
    final rows = [for (var i = 0; i < 450; i++) OpenRouterCatalogModel(id: 'vendor/model-$i', name: 'Model $i', contextLength: 128000, supportsTools: true), OpenRouterCatalogModel(id: 'openrouter/free', name: 'Free router', isRouter: true)];
    await tester.pumpWidget(MaterialApp(theme: buildLiminalTheme(), home: Scaffold(body: SingleChildScrollView(child: Padding(padding: const EdgeInsets.all(20), child: OpenRouterModelPicker(value: 'vendor/model-2', singleModel: true, load: (_) async => rows, onChanged: changes.add))))));
    await tester.pumpAndSettle();
    expect(find.text('451 models · individual models, no bundles'), findsOneWidget);
    final search = find.widgetWithText(TextField, 'Search OpenRouter models…');
    await tester.enterText(search, 'VENDOR/MODEL-449'); await tester.pumpAndSettle();
    await tester.tap(find.text('Model 449')); await tester.pumpAndSettle();
    expect(changes, ['vendor/model-449']);
    await tester.enterText(search, 'openrouter/free'); await tester.pumpAndSettle();
    expect(tester.widget<ListTile>(find.widgetWithText(ListTile, 'Free router')).enabled, false);
    expect(tester.takeException(), isNull);
  });
  testWidgets('catalog errors preserve selection and allow retry', (tester) async {
    var tries = 0; final changes = <String>[];
    await tester.pumpWidget(MaterialApp(theme: buildLiminalTheme(), home: Scaffold(body: SingleChildScrollView(child: OpenRouterModelPicker(value: 'vendor/current', onChanged: changes.add, load: (_) async {
      if (++tries == 1) throw StateError('offline');
      return [OpenRouterCatalogModel(id: 'vendor/current', name: 'Current model')];
    })))));
    await tester.pumpAndSettle();
    expect(find.textContaining('Your selection has not changed.'), findsOneWidget); expect(changes, isEmpty);
    await tester.tap(find.text('Refresh')); await tester.pumpAndSettle();
    expect(tries, 2); expect(changes, isEmpty); expect(find.text('Current model'), findsNWidgets(2));
    expect(tester.takeException(), isNull);
  });
}

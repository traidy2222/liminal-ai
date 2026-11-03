import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:liminal_desktop/core/usage/usage_analytics.dart';
import 'package:liminal_desktop/core/usage/usage_turn_tracker.dart';
import 'package:liminal_desktop/ui/widgets/usage_analytics_panel.dart';

void main() {
  late Directory directory;
  late File preferences;
  late List<http.Request> requests;
  late DateTime now;
  late UsageAnalytics analytics;
  setUp(() async {
    directory = await Directory.systemTemp.createTemp('liminal-usage-test-');
    preferences = File('${directory.path}/usage.json');
    requests = [];
    now = DateTime.utc(2026, 11, 3);
    analytics = UsageAnalytics(
        preferencesFile: preferences,
        enabledForBuild: true,
        platform: 'windows',
        now: () => now,
        loadVersion: () async => '0.1.11',
        client: MockClient((request) async {
          requests.add(request);
          return http.Response('', 204);
        }),);
  });
  tearDown(() async {
    analytics.dispose();
    await directory.delete(recursive: true);
  });

  test(
      'no identity, preference file or network request before consent, including refusal',
      () async {
    await analytics.initialize();
    await analytics.record(UsageMilestone.conversationCompleted);
    expect(analytics.choice, isNull);
    expect(await preferences.exists(), isFalse);
    expect(requests, isEmpty);
    await analytics.choose(false);
    await analytics.record(UsageMilestone.appReady);
    expect(requests, isEmpty);
    expect(jsonDecode(await preferences.readAsString())['installation_id'],
        isNull,);
  });

  test('fixed payload, daily deduplication, repeat days and persisted identity',
      () async {
    await analytics.choose(true);
    await analytics.record(UsageMilestone.appOpen);
    await analytics.record(UsageMilestone.appReady);
    await analytics.record(UsageMilestone.conversationCompleted);
    await analytics.record(UsageMilestone.conversationCompleted);
    expect(requests.length, 3);
    final first = jsonDecode(requests.first.body) as Map<String, dynamic>;
    expect(first.keys.toSet(),
        {'schema', 'installation_id', 'event', 'version', 'platform'},);
    expect(first['installation_id'], matches(RegExp(r'^[a-f0-9]{64}$')));
    final identity = first['installation_id'];
    now = now.add(const Duration(days: 1));
    await analytics.record(UsageMilestone.conversationCompleted);
    expect(requests.length, 4);
    expect(jsonDecode(requests.last.body)['installation_id'], identity);
    final restored = UsageAnalytics(
        preferencesFile: preferences,
        enabledForBuild: true,
        platform: 'windows',
        now: () => now,
        loadVersion: () async => '0.1.11',
        client: MockClient((request) async {
          requests.add(request);
          return http.Response('', 204);
        }),);
    await restored.initialize();
    await restored.record(UsageMilestone.appOpen);
    await restored.record(UsageMilestone.conversationCompleted);
    expect(requests.length,
        5,); // One new-day app open; conversation already recorded.
    expect(jsonDecode(requests.last.body)['installation_id'], identity);
    restored.dispose();
  });

  test(
      'withdrawal stops queued and subsequent sharing; deletion removes only its own identity',
      () async {
    await analytics.choose(true);
    await analytics.record(UsageMilestone.appOpen);
    final identity = jsonDecode(requests.first.body)['installation_id'];
    await analytics.choose(false);
    final length = requests.length;
    await analytics.record(UsageMilestone.appReady);
    await analytics.record(UsageMilestone.conversationCompleted);
    expect(requests.length, length);
    await analytics.deleteSharedHistory();
    expect(requests.last.method, 'DELETE');
    expect(jsonDecode(requests.last.body),
        {'schema': 1, 'installation_id': identity},);
    expect(analytics.sharing, isFalse);
    expect(analytics.hasSharedIdentity, isFalse);
    expect(jsonDecode(await preferences.readAsString())['installation_id'],
        isNull,);
  });

  test(
      'network failure is non-fatal, rate limited locally, and deletion can be retried',
      () async {
    final failedRequests = <http.Request>[];
    final failing = UsageAnalytics(
        preferencesFile: preferences,
        enabledForBuild: true,
        platform: 'windows',
        now: () => now,
        loadVersion: () async => '0.1.11',
        client: MockClient((request) async {
          failedRequests.add(request);
          return http.Response('', 503);
        }),);
    await failing.choose(true);
    await failing.record(UsageMilestone.appOpen);
    await failing.record(UsageMilestone.appReady);
    expect(failedRequests.length, 1);
    now = now.add(const Duration(minutes: 6));
    await failing.record(UsageMilestone.appReady);
    expect(failedRequests.length, 2);
    await failing.deleteSharedHistory();
    expect(failing.sharing, isFalse);
    expect(failing.hasSharedIdentity, isTrue);
    expect(failing.error, contains('Could not confirm deletion'));
    failing.dispose();
  });

  test('development builds ignore even an opted-in preference and send nothing',
      () async {
    await preferences.writeAsString(jsonEncode(
        {'schema': 1, 'consent': true, 'installation_id': 'a' * 64},),);
    final development = UsageAnalytics(
        preferencesFile: preferences,
        enabledForBuild: false,
        client: MockClient((request) async {
          requests.add(request);
          return http.Response('', 204);
        }),);
    await development.initialize();
    await development.record(UsageMilestone.appOpen);
    await development.choose(true);
    expect(requests, isEmpty);
    development.dispose();
  });

  test('a revoked queued milestone is not transmitted', () async {
    final response = Completer<http.Response>();
    final pending = UsageAnalytics(
        preferencesFile: preferences,
        enabledForBuild: true,
        loadVersion: () async => '0.1.11',
        platform: 'windows',
        client: MockClient((request) async {
          requests.add(request);
          return response.future;
        }),);
    await pending.choose(true);
    await Future<void>.delayed(Duration.zero);
    final queued = pending.record(UsageMilestone.conversationCompleted);
    final revoke = pending.choose(false);
    response.complete(http.Response('', 204));
    await Future.wait([queued, revoke]);
    expect(requests.length, 1);
    pending.dispose();
  });

  test(
      'completion requires a live user turn and answer text, with no error/cancel',
      () {
    final tracker = UsageTurnTracker();
    expect(tracker.observe('background', 'turn_end', {}), isFalse);
    tracker.begin('a');
    tracker.observe('a', 'transcript_replay', {'messages': 'old content'});
    tracker.observe('a', 'text', {'channel': 'reasoning', 'delta': 'thinking'});
    expect(tracker.observe('a', 'turn_end', {}), isFalse);
    tracker.begin('a');
    tracker.observe('a', 'text', {'delta': 'answer'});
    expect(tracker.observe('a', 'turn_end', {'harnessMetrics': {'terminationReason': 'ok'}}), isTrue);
    expect(tracker.observe('a', 'turn_end', {}), isFalse);
    for (final end in ['error', 'cancel', 'disconnect']) {
      tracker.begin('a');
      tracker.observe('a', 'text', {'delta': 'partial answer'});
      if (end == 'error') tracker.observe('a', 'error', {});
      if (end == 'cancel') tracker.cancel('a');
      if (end == 'disconnect') tracker.clear();
      expect(tracker.observe('a', 'turn_end', {}), isFalse);
    }
  });

  test('partial answers do not count when turn_end precedes a later error frame', () {
    final tracker = UsageTurnTracker();
    for (final reason in ['error', 'aborted', 'send_timeout', 'unknown']) {
      tracker.begin('a');
      tracker.observe('a', 'text', {'delta': 'partial'});
      expect(tracker.observe('a', 'turn_end', {'harnessMetrics': {'terminationReason': reason}}), isFalse);
      tracker.observe('a', 'error', {});
    }
  });

  testWidgets('first-run refusal persists and settings start disabled',
      (tester) async {
    final ui = _UsageChoiceFake();
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: SingleChildScrollView(
                child: UsageAnalyticsPanel(
                    analytics: ui, compact: true,),),),),);
    expect(find.text('Share basic usage'), findsOneWidget);
    expect(requests, isEmpty);
    await tester.tap(find.text('No thanks'));
    await tester.pumpAndSettle();
    expect(ui.choice, isFalse);
    expect(find.text('Share basic usage'), findsNothing);
    expect(requests, isEmpty);
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: SingleChildScrollView(
                child: UsageAnalyticsPanel(analytics: ui),),),),);
    expect(find.byType(SwitchListTile), findsOneWidget);
    expect(tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
        isFalse,);
    await tester.tap(find.byType(SwitchListTile));
    await tester.pumpAndSettle();
    expect(ui.choice, isTrue);
    await tester.tap(find.byType(SwitchListTile));
    await tester.pumpAndSettle();
    expect(ui.choice, isFalse);
    ui.dispose();
  });
}

// Service persistence/network behaviour is exercised above. The widget test
// keeps native filesystem IO outside Flutter's fake-async event loop.
class _UsageChoiceFake extends UsageAnalytics {
  _UsageChoiceFake() : super(enabledForBuild: true) { initialized = true; }
  @override
  Future<void> choose(bool consent) async { choice = consent; notifyListeners(); }
}

import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/core/connection_keepalive.dart';

void main() {
  test('reconnectDelayMs grows with attempt and caps at 8s', () {
    expect(reconnectDelayMs(0), 300);
    expect(reconnectDelayMs(1), 600);
    expect(reconnectDelayMs(5), 8000);
    expect(reconnectDelayMs(10), 8000);
  });
}

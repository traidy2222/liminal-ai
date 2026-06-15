import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/core/update/release_client.dart';
import 'package:liminal_desktop/core/update/semver.dart';

void main() {
  group('semver', () {
    test('compare orders versions', () {
      expect(compareSemver('0.1.0', '0.1.1'), lessThan(0));
      expect(isVersionLess('0.1.0', '0.2.0'), isTrue);
      expect(normalizeVersion('v1.0.0'), '1.0.0');
    });
  });

  group('ReleaseClient', () {
    test('artifact file names match GitHub release layout', () {
      expect(
        ReleaseClient.desktopArtifactFile('windows', '0.1.0'),
        'liminal-desktop-windows-x64-v0.1.0.zip',
      );
      expect(
        ReleaseClient.liminaldRuntimeFile('0.1.0'),
        'liminald-runtime-v0.1.0.zip',
      );
      expect(
        ReleaseClient.downloadUrl('v0.1.0-desktop', 'liminald-runtime-v0.1.0.zip'),
        'https://github.com/traidy2222/liminal-ai/releases/download/v0.1.0-desktop/liminald-runtime-v0.1.0.zip',
      );
    });
  });
}

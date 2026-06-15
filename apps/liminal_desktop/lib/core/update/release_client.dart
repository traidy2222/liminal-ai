import 'dart:convert';

import 'package:http/http.dart' as http;

import 'semver.dart';

const _githubRepo = 'traidy2222/liminal-ai';
const _releasesUrl = 'https://api.github.com/repos/$_githubRepo/releases?per_page=100';

class ReleaseAsset {
  ReleaseAsset({
    required this.file,
    required this.url,
    required this.sha256Url,
  });

  final String file;
  final String url;
  final String sha256Url;
}

class DesktopReleaseInfo {
  DesktopReleaseInfo({
    required this.version,
    required this.tag,
    required this.publishedAt,
    required this.notesUrl,
    required this.liminaldAsset,
    required this.platformAssets,
  });

  final String version;
  final String tag;
  final String publishedAt;
  final String notesUrl;
  final ReleaseAsset liminaldAsset;
  final Map<String, ReleaseAsset> platformAssets;
}

class UpdateCheckResult {
  UpdateCheckResult({
    required this.latest,
    required this.harnessUpdate,
    required this.appUpdate,
    required this.currentApp,
    required this.currentHarness,
  });

  final DesktopReleaseInfo latest;
  final bool harnessUpdate;
  final bool appUpdate;
  final String currentApp;
  final String currentHarness;

  bool get anyUpdate => harnessUpdate || appUpdate;
}

class ReleaseClient {
  ReleaseClient({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  static String desktopArtifactFile(String platform, String version) {
    switch (platform) {
      case 'windows':
        return 'liminal-desktop-windows-x64-v$version.zip';
      case 'macos':
        return 'liminal-desktop-macos-arm64-v$version.zip';
      case 'linux':
        return 'liminal-desktop-linux-x64-v$version.tar.gz';
      default:
        throw ArgumentError('Unknown platform: $platform');
    }
  }

  static String liminaldRuntimeFile(String version) =>
      'liminald-runtime-v$version.zip';

  static String downloadUrl(String tag, String file) =>
      'https://github.com/$_githubRepo/releases/download/$tag/$file';

  Future<DesktopReleaseInfo> fetchLatestDesktopRelease() async {
    final res = await _client.get(
      Uri.parse(_releasesUrl),
      headers: const {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'liminal-desktop-updater',
      },
    );
    if (res.statusCode != 200) {
      throw Exception('GitHub releases failed: ${res.statusCode}');
    }

    final releases = (jsonDecode(res.body) as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .where((r) => RegExp(r'^v.+-desktop$', caseSensitive: false)
            .hasMatch(r['tag_name'] as String? ?? ''))
        .toList();

    releases.sort((a, b) {
      final ta = RegExp(r'^v(.+)-desktop$', caseSensitive: false)
          .firstMatch(a['tag_name'] as String? ?? '');
      final tb = RegExp(r'^v(.+)-desktop$', caseSensitive: false)
          .firstMatch(b['tag_name'] as String? ?? '');
      return compareSemver(tb?.group(1) ?? '', ta?.group(1) ?? '');
    });

    if (releases.isEmpty) {
      throw Exception('No desktop releases found');
    }

    final latest = releases.first;
    final tag = latest['tag_name'] as String;
    final match = RegExp(r'^v(.+)-desktop$', caseSensitive: false).firstMatch(tag);
    final version = normalizeVersion(match?.group(1) ?? '');

    ReleaseAsset assetFor(String file) {
      final assets = (latest['assets'] as List<dynamic>? ?? [])
          .cast<Map<String, dynamic>>();
      final hit = assets.where((a) => a['name'] == file).toList();
      final url = hit.isNotEmpty
          ? hit.first['browser_download_url'] as String
          : downloadUrl(tag, file);
      return ReleaseAsset(
        file: file,
        url: url,
        sha256Url: '$url.sha256',
      );
    }

    return DesktopReleaseInfo(
      version: version,
      tag: tag,
      publishedAt: latest['published_at'] as String? ?? '',
      notesUrl: 'https://github.com/$_githubRepo/releases/tag/$tag',
      liminaldAsset: assetFor(liminaldRuntimeFile(version)),
      platformAssets: {
        'windows': assetFor(desktopArtifactFile('windows', version)),
        'macos': assetFor(desktopArtifactFile('macos', version)),
        'linux': assetFor(desktopArtifactFile('linux', version)),
      },
    );
  }

  Future<UpdateCheckResult> check({
    required String appVersion,
    required String harnessVersion,
  }) async {
    final latest = await fetchLatestDesktopRelease();
    return UpdateCheckResult(
      latest: latest,
      harnessUpdate: isVersionLess(harnessVersion, latest.version),
      appUpdate: isVersionLess(appVersion, latest.version),
      currentApp: appVersion,
      currentHarness: harnessVersion,
    );
  }

  Future<String?> fetchSha256(String sha256Url) async {
    final res = await _client.get(Uri.parse(sha256Url));
    if (res.statusCode != 200) return null;
    final line = res.body.trim().split(RegExp(r'\r?\n')).first;
    final match = RegExp(r'^([a-f0-9]{64})\b', caseSensitive: false).firstMatch(line);
    return match?.group(1)?.toLowerCase();
  }

  void close() => _client.close();
}

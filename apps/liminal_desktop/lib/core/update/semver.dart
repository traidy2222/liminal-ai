/// Compare dotted semver strings (major.minor.patch).
int compareSemver(String a, String b) {
  final pa = _parts(a);
  final pb = _parts(b);
  final len = [pa.length, pb.length, 3].reduce((x, y) => x > y ? x : y);
  for (var i = 0; i < len; i++) {
    final da = i < pa.length ? pa[i] : 0;
    final db = i < pb.length ? pb[i] : 0;
    if (da != db) return da.compareTo(db);
  }
  return 0;
}

bool isVersionLess(String a, String b) => compareSemver(a, b) < 0;

List<int> _parts(String version) {
  final normalized = version.trim().replaceFirst(RegExp(r'^v'), '');
  return normalized
      .split(RegExp(r'[.\-+]'))
      .map((p) => int.tryParse(p) ?? 0)
      .toList();
}

String normalizeVersion(String version) =>
    version.trim().replaceFirst(RegExp(r'^v'), '');

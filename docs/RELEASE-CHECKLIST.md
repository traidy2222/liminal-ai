# Release Checklist

Step-by-step release process for Liminal AI releases.

## Prerequisites

- [ ] Write access to `traidy2222/liminal-ai` GitHub repository
- [ ] Node.js 20+ installed
- [ ] Flutter SDK (for desktop releases)
- [ ] All planned changes merged to `main`

---

## Phase 1: Pre-Release Validation

### 1.1 Branch Preparation

```bash
git checkout main
git pull origin main
```

- [ ] Confirm `main` is up to date with remote
- [ ] Verify no uncommitted changes: `git status --porcelain`
- [ ] Verify HEAD matches origin: `git rev-parse HEAD` equals `git rev-parse origin/main`

### 1.2 CI Verification

```bash
npm ci
npm run typecheck
npm run test
```

- [ ] `npm ci` completes without errors
- [ ] `npm run typecheck` passes for all workspaces
- [ ] `npm run test` passes for @liminal/core

### 1.3 Build Verification

```bash
npm run build
```

- [ ] All workspace packages build successfully
- [ ] No build warnings that block release

### 1.4 Secret Audit

```bash
npm run verify:repo-secrets
npm run verify-harness-defaults-no-secrets
```

- [ ] No secrets or credentials in committed files
- [ ] `.env.example` contains only placeholder values

---

## Phase 2: Version Bump

### 2.1 Determine Version

- Current version: Check `changelog/releases.json` → `currentVersion`
- New version: Increment according to release type:
  - **Patch** (`0.0.x`): Bug fixes, minor improvements
  - **Minor** (`0.x.0`): New features, backward compatible
  - **Major** (`x.0.0`): Breaking changes (not applicable in alpha)

### 2.2 Update Changelog Source

Edit `changelog/releases.json`:

1. Update `currentVersion` to new version
2. Add new release entry at top of `releases` array:

```json
{
  "version": "0.0.27",
  "date": "2026-06-14",
  "tagline": "Brief one-line description",
  "summary": "Longer summary of changes for CHANGELOG.md",
  "bullets": [
    "**Feature name** — Description of feature",
    "**Fix name** — Description of fix"
  ],
  "docs": [
    { "label": "Guide Name", "href": "../guides/guide.md" }
  ]
}
```

### 2.3 Generate Changelog Files

```bash
npm run changelog:gen
```

This generates:
- `CHANGELOG.md` (root)
- `docs/reference/changelog.md` (docs portal)

- [ ] Verify generated files contain correct version
- [ ] Verify current version has "Current alpha" label

---

## Phase 3: Git Tag

### 3.1 Commit Changes

```bash
git add changelog/releases.json CHANGELOG.md docs/reference/changelog.md
git commit -m "chore: release v0.0.27

- Update changelog for v0.0.27 release
- Mark v0.0.27 as current alpha

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

- [ ] Commit includes changelog changes only
- [ ] Commit message follows conventional commit format

### 3.2 Create Tag

**For Core/Liminald Release:**

```bash
git tag -a v0.0.27 -m "Release v0.0.27"
```

**For Desktop Release:**

```bash
git tag -a v0.0.27-desktop -m "Desktop Release v0.0.27"
```

- [ ] Tag name follows: `v{version}` for core, `v{version}-desktop` for desktop
- [ ] Tag is annotated with `-a` flag
- [ ] Tag message describes the release

---

## Phase 4: Push and Trigger CI

### 4.1 Push Commit and Tag

```bash
git push origin main
git push origin v0.0.27
```

or for desktop:

```bash
git push origin v0.0.27-desktop
```

- [ ] Main branch pushed successfully
- [ ] Tag pushed to remote

### 4.2 Verify CI Workflow

For desktop releases, the GitHub Actions workflow `release-desktop.yml` triggers automatically on tag push.

- [ ] Check GitHub Actions: https://github.com/traidy2222/liminal-ai/actions
- [ ] Workflow runs for all platforms: Windows, macOS, Linux
- [ ] All jobs pass (green checkmarks)

If CI fails:
- Do not proceed to announcement
- Investigate and fix issues
- Delete tag if needed: `git push --delete origin v0.0.27`
- Fix and re-tag

---

## Phase 5: GitHub Release

### 5.1 Create GitHub Release

Navigate to: https://github.com/traidy2222/liminal-ai/releases/new

**For Core Release:**

- Tag: `v0.0.27`
- Title: `Liminal v0.0.27`
- Description: Copy from `CHANGELOG.md` entry

**For Desktop Release:**

- Tag: `v0.0.27-desktop`
- Title: `Liminal Desktop v0.0.27`
- Description: Use auto-generated release notes from workflow

- [ ] Release created on GitHub
- [ ] Correct tag selected
- [ ] Release notes match changelog content
- [ ] For desktop: artifacts (zip/tar.gz) attached automatically by CI

### 5.2 Verify Artifacts (Desktop)

Desktop releases should have:

| Platform | Artifact |
|----------|----------|
| Windows | `liminal-desktop-windows-x64-v{version}.zip` + `.sha256` |
| macOS | `liminal-desktop-macos-arm64-v{version}.zip` + `.sha256` |
| Linux | `liminal-desktop-linux-x64-v{version}.tar.gz` + `.sha256` |
| Harness only | `liminald-runtime-v{version}.zip` + `.sha256` |
| Manifest | `liminal-desktop-manifest-v{version}.json` |

- [ ] All platform artifacts present
- [ ] `liminald-runtime` harness zip present (in-app harness auto-update)
- [ ] Desktop manifest JSON attached (`node scripts/generate-desktop-manifest.mjs`)
- [ ] SHA256 checksums attached
- [ ] Artifacts downloadable

---

## Phase 6: Announcements

### 6.1 Internal Announcement

Post to internal channels (Discord, Slack, etc.):

```
🚀 Liminal v0.0.27 released

Key changes:
- Feature 1
- Feature 2
- Fix 1

Changelog: https://docs.vireondynamics.com/liminal/reference/changelog#v-0-0-27
Download: https://github.com/traidy2222/liminal-ai/releases/tag/v0.0.27
```

- [ ] Announcement posted
- [ ] Link to changelog included
- [ ] Link to GitHub release included

### 6.2 Update Documentation Portal

If docs portal needs sync:

```bash
# In vireondynamics-website repo
npm run docs-portal:sync
npm run docs-portal:deploy
```

- [ ] Docs portal synchronized (if applicable)

---

## Phase 7: Post-Release Verification

### 7.1 Smoke Test

- [ ] Verify release appears on GitHub: https://github.com/traidy2222/liminal-ai/releases
- [ ] Verify changelog updated: https://docs.vireondynamics.com/liminal/reference/changelog
- [ ] Download artifact and test basic functionality (desktop)

### 7.2 Issue Tracking

- [ ] Close any release-related issues
- [ ] Update project board status
- [ ] Document any follow-up issues discovered during release

---

## Rollback Procedure

If critical issues discovered post-release:

### Immediate Rollback

1. Delete GitHub release (does not delete tag)
2. Yank tag from remote:
   ```bash
   git push --delete origin v0.0.27
   git tag --delete v0.0.27
   ```
3. Revert changelog commit if not yet pushed separately
4. Announce rollback

### Hotfix Release

1. Create hotfix branch from tag:
   ```bash
   git checkout -b hotfix/v0.0.28 v0.0.27
   ```
2. Apply fix
3. Follow full release process for v0.0.28

---

## Quick Reference Commands

```bash
# Pre-release
git checkout main && git pull origin main
npm ci && npm run typecheck && npm run test && npm run build
npm run verify:repo-secrets

# Version bump
# Edit changelog/releases.json
npm run changelog:gen

# Commit and tag
git add changelog/releases.json CHANGELOG.md docs/reference/changelog.md
git commit -m "chore: release v0.0.27"
git tag -a v0.0.27 -m "Release v0.0.27"

# Push
git push origin main
git push origin v0.0.27

# Desktop release
git tag -a v0.0.27-desktop -m "Desktop Release v0.0.27"
git push origin v0.0.27-desktop
```

---

## Versioning Convention

| Release Type | Tag Format | Example |
|--------------|------------|---------|
| Core/Liminald | `v{major}.{minor}.{patch}` | `v0.0.27` |
| Desktop | `v{major}.{minor}.{patch}-desktop` | `v0.0.27-desktop` |

During **alpha** stage:
- Version prefix: `0.0.x`
- No semver compatibility guarantees
- Breaking changes allowed between versions

---

## Contacts

- **CTO**: Escalate release blockers
- **Engineering**: Coordinate feature completion
- **QA**: Desktop smoke testing

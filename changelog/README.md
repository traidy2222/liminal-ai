# Changelog (single source)

Edit **`releases.json`** (newest release first), then regenerate markdown:

```bash
npm run changelog:gen
```

This updates:

- `docs/reference/changelog.md` — full technical notes (docs portal)
- `CHANGELOG.md` — short index in the repo root

After pushing liminal-ai, sync and deploy docs from [vireondynamics-website](https://github.com/traidy2222/vireondynamics-website):

```bash
npm run docs-portal:sync
npm run docs-portal:deploy
```

Marketing pages (`content/changelog/v0-0-N.mdx`) still live in the website repo; bump `liminal-release.json` and add an MDX slice when you want a featured release on [vireondynamics.com/liminal/changelog](https://www.vireondynamics.com/liminal/changelog).

To re-import from an edited `docs/reference/changelog.md` (one-off migration): `npm run changelog:import`

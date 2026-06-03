# Liminal documentation

Operator docs for the Liminal harness. **Published:** [docs.vireondynamics.com/liminal/](https://docs.vireondynamics.com/liminal/)

Start at **[index.md](./index.md)** for the full learning path.

## Quick links

| If you need… | Document |
|--------------|----------|
| One-command install | [start/install.md](./start/install.md) |
| First TUI/web session | [start/quickstart.md](./start/quickstart.md) |
| Settings vs `.env` | [start/configuration-basics.md](./start/configuration-basics.md) |
| Persona / vault workflows | [guides/persona-bootstrap.md](./guides/persona-bootstrap.md), [guides/vault-briefs-and-updates.md](./guides/vault-briefs-and-updates.md) |
| Changelog / roadmap | [reference/changelog.md](./reference/changelog.md), [reference/roadmap.md](./reference/roadmap.md) |
| Full `AGENT_*` list | [reference/environment.md](./reference/environment.md) |
| Common failures | [operations/troubleshooting.md](./operations/troubleshooting.md) |

## Maintenance

| Task | Command |
|------|---------|
| Regenerate env table | `npm run docs:gen` |
| Validate links | `npm run docs:check` |
| Local VitePress | `npm run docs:dev` |
| Sync + publish portal | In `vireondynamics-website`: `npm run docs-portal:sync` then `npm run docs-portal:deploy` (copies this `docs/` tree — required after changelog edits) |

Edit harness docs here (`docs/`). Edit the multi-product hub in `vireondynamics-website/docs-portal/index.md` (separate repo — not `website/` inside this tree).

# AI code reviews

## CodeRabbit: automatic PR reviews

The root `.coderabbit.yaml` enables assertive reviews of ready-for-review PRs
and incremental pushes, with Liminal-specific path instructions. `REVIEW.md`
defines the common review criteria. Generated build output is excluded; source,
tests, dependency manifests/locks and GitHub workflows remain reviewable.

Install the [CodeRabbit GitHub app](https://github.com/apps/coderabbitai) on
**only `traidy2222/liminal-ai`**. Committing configuration does not install the
app. Its public-repository reviews are free subject to service limits. Do not
enable paid usage-based reviews or Deep Scan as part of this setup.

After installation, open a non-draft PR against `main` and check for a completed
CodeRabbit review. On an existing PR, comment `@coderabbitai review` to request
a review. A configured file alone is not evidence of a completed review.

## Qodo: on-demand second opinion

The root `.pr_agent.toml` disables automatic Qodo commands to avoid duplicating
every CodeRabbit review. When an eligible hosted installation is connected,
comment `/agentic_review` on a PR for an extended review. It reads `REVIEW.md`,
prioritises actionable findings and has automatic fixes/approval disabled.

As checked on 2026-11-02, the [free Qodo marketplace app](https://github.com/marketplace/qodo-merge-pro-for-open-source)
requires a public repository with at least 200 stars. Liminal had 1 star at
setup, so this configuration is prepared but does not establish free eligibility
or an active Qodo installation. Do not substitute a paid trial automatically.

## Independent PR-Agent: self-hosted alternative

[PR-Agent](https://github.com/The-PR-Agent/pr-agent) is separate from hosted Qodo.
Its `[pr_reviewer]` and `[config]` sections are included in `.pr_agent.toml`.
The `[review_agent]` section belongs to hosted Qodo; do not assume those settings
apply to PR-Agent. Both tools use the empty GitHub automatic command lists.

No PR-Agent Action or model credentials are installed. Before enabling it,
choose an existing local model and runner, or explicitly approve an API budget.
Configure provider endpoints and credentials on the host, never in this repo.
For local review, the upstream CLI accepts
`pr-agent --pr_url https://github.com/traidy2222/liminal-ai/pull/NUMBER review`.
The CLI still needs installation, GitHub authentication and model configuration.

## Maintenance

- Review feedback is advisory. Keep existing CI checks and maintainer judgement.
- Review configuration changes as privileged policy changes. Do not let
  untrusted PRs select a model endpoint, secrets or arbitrary commands.
- Validate `.coderabbit.yaml` against the vendor schema in its first line and
  parse `.pr_agent.toml` before changing review behaviour.
- These services review PR changes; they do not establish a full audit of all
  existing repository code. No paid full-codebase scan is enabled here.

References: [CodeRabbit configuration](https://docs.coderabbit.ai/reference/configuration),
[Qodo configuration](https://docs.qodo.ai/configuration/configuration-file),
[PR-Agent configuration](https://docs.pr-agent.ai/usage-guide/configuration_options/).

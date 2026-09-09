# <img src="assets/avocetta.png" alt="avocetta mascot, an avocet" height="55"> avocetta [![CI](https://github.com/korya/avocetta/actions/workflows/ci.yml/badge.svg)](https://github.com/korya/avocetta/actions/workflows/ci.yml) [![Marketplace](https://img.shields.io/github/v/release/korya/avocetta?label=marketplace&logo=github&color=2ea44f)](https://github.com/marketplace/actions/avocetta-lint)

avocetta is a deterministic linter for [agent skills](https://agentskills.io/specification)
and [agent plugins](https://agent-plugins.org/). It verifies compliance with the open
specs and with what specific runtimes (Claude Code, Codex) actually enforce, so you
catch incompatibilities in CI before your users do.

It is plain static analysis: it never calls a model or the network at lint time, and it
works without a config file.

- Four compliance dialects, each versioned and frozen: the agentskills.io and
  agent-plugins.org specs, Claude Code, and Codex
- Auto-detection of what you point it at (a skill, a plugin, a marketplace repo) and of
  which dialects your layout targets
- Union runs: lint against several runtimes at once, with guidance when their layouts
  seem to conflict
- Vendor rules backed by verified runtime behavior, with sources cited in every dialect
  file
- Text, JSON, SARIF, and GitHub-annotation output
- A zero-config GitHub Action and an installation-free CLI (`npx avocetta`)

<img src="assets/avocetta-in-action.png" alt="The avocetta picking bugs out of a pile of broken files, with a tidy plugin tree on the other bank" width="100%">

## GitHub Action

```yaml
- uses: korya/avocetta@v2
```

That's it. The action detects what your repo is (a skill, a plugin, a marketplace of
plugins), picks the right compliance targets (the spec dialects always; Claude Code and
Codex when your layout shows you target them), annotates PR diffs inline, and fails the
job on errors.

Optional inputs mirror the CLI flags:

```yaml
- uses: korya/avocetta@v2
  with:
    path: plugins/my-plugin
    dialect: spec,claude,codex   # pin targets explicitly
    strict: "true"               # warnings fail the job
    pedantic: "true"             # opinion-tier checks
```

## CLI

```console
$ npx avocetta
avocetta · dialects: agentskills@1.0.0, agent-plugins@1.0.0, claude-code@2026-09

skills/examine/SKILL.md
  ✖ [agentskills@1.0.0, claude-code@2026-09] skill/frontmatter-schema  frontmatter is not valid YAML: Nested mappings are not allowed in compact mappings (3:14)

1 error · 0 warnings
```

## Options

The CLI flags and the Action inputs share names and meaning:

| Option | What it does |
|---|---|
| `--dialect <names>` | Which compliance targets to lint against: `spec`, `agentskills`, `agent-plugins`, `claude`, `codex`, `all`, or a pinned `name@version` (comma-separated). Selecting several means your files must satisfy each of them. Default: the spec dialects, plus Claude Code / Codex automatically when your repo layout shows you target them. |
| `--strict` | Treat warnings as errors (exit 1). Warnings normally flag silent degradation, such as a description a runtime truncates or an oversized body; strict mode makes those block. |
| `--pedantic` | Enable opinion-tier checks that are off by default, such as `.agents/skills` copies drifting out of sync with their plugin originals. |
| `--format <name>` | Output format: `text` (default in a terminal), `json` (machine-readable), `sarif` (GitHub code scanning), `github` (inline workflow annotations; the default inside GitHub Actions). |

## Examples

### CI gate: block PRs that break skill compatibility

```yaml
# .github/workflows/lint-skills.yml
name: Lint skills
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: korya/avocetta@v2
```

Violations show up as inline annotations on the PR diff; the job fails on errors and
passes on warnings (add `strict: "true"` to fail on warnings too).

### Local check while writing a skill

```console
$ npx avocetta skills/my-skill
avocetta · dialects: agentskills@1.0.0, agent-plugins@1.0.0

skills/my-skill/SKILL.md
  ✖ [agentskills@1.0.0] skill/name-format  name `My_Skill` is invalid: only lowercase letters, digits and single hyphens are allowed (2:7)

1 error · 0 warnings
```

avocetta works on any target shape: a single `SKILL.md`, a directory of skills, a plugin,
or a whole marketplace repo. Detection is automatic.

### Cross-runtime compatibility: "I built this for Claude Code. Will Codex take it?"

```console
$ npx avocetta --dialect claude,codex .
avocetta · dialects: claude-code@2026-09, codex@2026-09

skills/easy-speak/SKILL.md
  ⚠ [codex@2026-09] codex/skill-body-budget  SKILL.md is 11913 bytes, and Codex silently truncates skill contents at 8000 bytes on activation; instructions past the cut are lost

0 errors · 1 warning
```

When layouts genuinely diverge, the union run tells you how to satisfy both sides:

```text
  ⚠ [agent-plugins@1.0.0, claude-code@2026-09] conflict/dual-layout  this plugin satisfies
    agent-plugins@1.0.0 but not claude-code@2026-09; the layouts are compatible side by
    side: add .claude-plugin/plugin.json or a marketplace entry for Claude Code
```

### Pre-publish audit before listing in a marketplace

```console
$ npx avocetta --strict --pedantic .
```

`--strict` turns every silent degradation (truncated descriptions, oversized bodies)
into a blocker; `--pedantic` adds opinion-tier checks like `.agents/skills` copies that
have drifted from their plugin originals.

### Reproducible CI: pin dialect versions

```json
{
  "dialects": ["spec", "claude@2026-09", "codex@2026-09"]
}
```

With `avocetta.config.json` committed, a linter update can never redden your pipeline:
released dialect versions are frozen, and unpinned runs always print which versions
they resolved to.

### SARIF into GitHub code scanning

```yaml
      - run: npx avocetta --format sarif . > results.sarif
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: results.sarif
```

## Dialects

A dialect is what one consumer of your skills enforces, captured as a frozen, versioned
data file:

| Dialect | What it checks |
|---|---|
| `agentskills@1.0.0` | SKILL.md frontmatter, name grammar and directory match, description ≤ 1024 chars, body ≤ 500 lines |
| `agent-plugins@1.0.0` | `plugin.json` against the official JSON Schemas (vendored), `skills/` discovery layout |
| `claude-code@2026-09` | `.claude-plugin/` layout or marketplace coverage, marketplace schema and reserved names, 1536-char description display truncation |
| `codex@2026-09` | SKILL.md ≤ 8000 **bytes** (silently truncated on activation above that), description truncation at 1024 chars, skills-listing budget, `.agents/skills` sync (pedantic) |

Vendor facts are verified against the runtime source and live behavior, and cited in
each dialect file. Released dialect versions are frozen; pin them in `avocetta.config.json`
and results never change under you:

```json
{
  "dialects": ["spec", "claude@2026-09", "codex@2026-09"],
  "ignore": ["plugin/version-missing"],
  "pedantic": true
}
```

Selecting several dialects means your artifact must satisfy each; findings are tagged
with the objecting dialect(s), and a cross-dialect pass explains how to satisfy
seemingly conflicting layouts side by side.

## Design

See [docs/product.md](docs/product.md) for requirements and
[docs/architecture.md](docs/architecture.md) for how it works (parse-once engine,
dialects as data, append-only dialect registry). [CHANGELOG.md](CHANGELOG.md)
records what changed for users in each release.

## License

MIT

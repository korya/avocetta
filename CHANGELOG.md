# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Because Action consumers pin the floating `korya/avocetta@v2` tag, changes to what
avocetta flags reach their pipelines automatically. Entries lead with those: a new rule, a
changed severity, or an updated vendor fact. Changes that alter no diagnostic say so.
The evidence behind each vendor fact lives in [docs/dialects.md](docs/dialects.md).

## [Unreleased]

No change to any diagnostic.

### Changed

- Toolchain: vitest 5 and `@vitest/coverage-v8` 5. Neither reaches the published bundle,
  which esbuild builds. The 100% threshold gate was re-verified under 5 by adding an
  uncovered function and confirming all four metrics still fail the run.

## [2.0.1] - 2026-09-09

No change to any diagnostic, and none to how the Action is used.

### Fixed

- The Action declared `name: avocetta`, which GitHub Marketplace refuses: an Action's
  name must be unique across every action, user, and organization on GitHub, and the
  user account `Avocetta` has existed since 2023. It is now `Avocetta Lint`. This is a
  Marketplace display name only. Consumers still write `korya/avocetta@v2`, and the
  binary, the npm package, and the repository are unchanged.

## [2.0.0] - 2026-09-09

No change to any diagnostic: the same inputs produce the same findings and exit codes
as 1.0.3.

### Changed

- Renamed from `askl` to **avocetta**: repo `korya/avocetta`, npm `avocetta`
  (unscoped, replacing `@korya/askl`), binary `avocetta`, config
  `avocetta.config.json`. The mascot was already an avocet; the name now agrees
  with it.
- Action consumers move from `korya/askl@v1` to `korya/avocetta@v2`. GitHub
  redirects the old path, so `korya/askl@v1` keeps working, but `v1` is frozen at
  1.0.4 and receives no further dialect or rule updates.

### Deprecated

- `askl.config.json` is still read when `avocetta.config.json` is absent, and
  prints a notice on stderr saying so. Silently dropping a CI gate's ignore list
  would be worse than one extra read. It will be ignored in 3.0.0.

## [1.0.3] - 2026-09-02

No change to any diagnostic.

### Fixed

- The Action built its argument list with `[ cond ] && args+=(...)`, which returns
  non-zero when the condition is false and would fail the step under `bash -e` if it
  were ever the last line. It survived only by accident of ordering; the conditions
  are now `if` blocks.

## [1.0.2] - 2026-09-02

No change to any diagnostic.

### Added

- Releases are cut by pushing a `vX.Y.Z` tag. Every effect is idempotent, so a run
  that fails partway can be re-run once the cause is fixed. A workflow verifies the tag against
  `package.json` and `src/main.ts`, requires a non-empty changelog section, runs
  the full gate, and rebuilds and diffs `dist/` before creating the GitHub release
  from that section, moving the floating major tag, and publishing to npm through
  OIDC trusted publishing. See [AGENTS.md](AGENTS.md#releasing).
## [1.0.1] - 2026-09-02

No change to any diagnostic: the same inputs produce the same findings and exit codes
as 1.0.0, verified by running both bundles over the fixture corpus and two real
repositories.

### Fixed

- Removed a literal NUL byte from `src/engine/run.ts`, where a space separator was
  intended in a dedup key. git and grep treated the file as binary and silently
  skipped it.
- Removed unreachable code in `src/engine/parse.ts`: the `yaml` package declares
  `YAMLError.pos` required, so its optional chain and guard were dead.

### Changed

- `mergeAcrossDialects` uses a `Set`, dropping a duplicate-check branch no input
  could reach.
- Toolchain: TypeScript 7, vitest 4, `@types/node` 26, `actions/checkout` 7,
  `actions/setup-node` 7. None of these reach the published bundle, which esbuild
  builds.

## [1.0.0] - 2026-09-02

First stable release. Semantic versioning now covers the dialect registry, the rule
surface, the CLI flags, the Action inputs, and the config schema.

### Changed

- Action consumers move from `korya/askl@v0` to `korya/askl@v1`; `v0` stays frozen
  at 0.3.0.
- Diagnostic messages no longer use em dashes.

## [0.3.0] - 2026-09-02

### Added

- `plugin/manifest-coherence` (warn): a plugin's `name` and `version` must agree
  across `plugin.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`,
  and the marketplace entry whose `version` pins what Claude Code users install.
- `plugin/description-coherence` (pedantic): descriptions must agree across the
  plugin manifests. A marketplace entry's description is a standalone brief by
  design and is exempt.

## [0.2.1] - 2026-09-02

### Fixed

- The Action crashed for external consumers with `ERR_MODULE_NOT_FOUND`. The
  committed bundle still imported its dependencies at run time, which every
  environment with `node_modules` in reach had masked. `dist/cli.js` is now
  self-contained, and CI runs it with no `node_modules` in reach to keep it that way.

## [0.2.0] - 2026-09-02

### Changed

- Renamed from `agent-skills-lint` to **askl**: repo `korya/askl`, npm
  `@korya/askl`, binary `askl`, config `askl.config.json`. No change to any
  diagnostic.

## [0.1.0] - 2026-09-02

### Added

- Four compliance dialects, each a frozen versioned data file with cited sources:
  `agentskills@1.0.0`, `agent-plugins@1.0.0`, `claude-code@2026-09`, and
  `codex@2026-09` (verified against codex-cli 0.152.0, including the 8,000-byte
  SKILL.md activation cap).
- Target auto-detection for a skill, a directory of skills, a plugin, or a
  marketplace repo, and detection of which vendor dialects a layout targets.
- Union runs: several dialects at once, findings tagged with the objecting
  dialect(s), and `conflict/dual-layout` guidance when layouts appear to conflict.
- Output formats: text, JSON, SARIF, and GitHub annotations.
- A zero-config GitHub Action and an installation-free CLI.

[unreleased]: https://github.com/korya/avocetta/compare/v2.0.1...HEAD
[2.0.1]: https://github.com/korya/avocetta/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/korya/avocetta/compare/v1.0.3...v2.0.0
[1.0.3]: https://github.com/korya/avocetta/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/korya/avocetta/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/korya/avocetta/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/korya/avocetta/compare/v0.3.0...v1.0.0
[0.3.0]: https://github.com/korya/avocetta/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/korya/avocetta/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/korya/avocetta/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/korya/avocetta/releases/tag/v0.1.0

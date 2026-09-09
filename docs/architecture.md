# avocetta — Architecture

Companion to [product.md](product.md); requirement IDs (`[A3]`, `[B7]`, …) refer to it.

## Overview

The engine separates *reading* a repo from *judging* it. Files are parsed exactly once
into a shared document model; each selected dialect then runs its ruleset against that
same model. Dialects never touch the filesystem, so an N-dialect run costs one repo walk,
and every rule is testable against an in-memory fixture.

```
paths ──► target     ──► document model ──► dialect runs ──► diagnostics ──► reporters
          detector       (parsed once)       (N rulesets,     (tagged,        text/json/
                         YAML+positions       same model)      deduped)       sarif/gh
                         JSON manifests                           │
                         markdown AST                             ▼
                                                              exit 0 / 1
```

## Principles

1. **Parse once, judge N times.** Parsing lives in the engine; rules receive a read-only
   document model. Adding a dialect adds a ruleset pass, not a second repo walk.
2. **Rules are pure and dialect-blind.** A rule is a function of (model, params) →
   diagnostics. It never knows which dialect invoked it; parameters and severity are
   resolved by the dialect layer and handed in.
3. **Dialects are frozen data, not code.** A dialect is a data file: a base it extends,
   parameter deltas, severity overrides, and vendor-only rules it switches on.
   `extends` is **single-level, always to a spec base** — no chains, no diamond.
4. **Append-only registry** `[A5] [B7]`. A released dialect file is never edited. New
   upstream behavior is a new versioned file next to the frozen one. Version diffs are
   file diffs; pinned runs reproduce forever.
5. **Reporters own presentation.** Nothing upstream of a reporter knows how findings are
   displayed. New output formats are additive.
6. **Small dependency budget.** Six runtime deps, each earning its place (§ Dependencies).
   Hand-roll anything smaller than the dependency that would replace it.

## Document model

Produced by the engine, consumed read-only by rules:

- **YAML frontmatter** — parsed with source positions (`yaml` CST), so findings point at
  exact line:col.
- **JSON manifests** — `plugin.json`, `.claude-plugin/plugin.json`, `marketplace.json`,
  `mcp.json`, with JSON-pointer → position mapping for schema errors.
- **Markdown AST** — `remark-parse` mdast with positions, for body-size, link, and
  structure rules.
- **File tree facts** — directory names, symlink-resolved real paths (for containment
  checks), file sizes.

## Diagnostics

The single shape everything downstream speaks:

```ts
type Diagnostic = {
  rule: string            // namespaced rule id, e.g. "skill/description-length"
  dialects: DialectId[]   // who objects — identical findings merge across dialects
  severity: "error" | "warn"
  file: string
  range: [Pos, Pos]       // exact line:col from parser positions
  message: string
  fix?: TextEdit[]        // mechanical fixes only (e.g. rename a field)
}
```

The `dialects` array keeps output clean: when spec and Codex object to the same
overlong description, the reporter prints one line tagged `[spec, codex]`, not two
findings.

## Rules

A rule declares its id, what it applies to, and its parameter schema:

```ts
const descriptionLength = defineRule({
  id: "skill/description-length",
  appliesTo: "skill",
  params: { max: number, unit: "chars" | "bytes", includeWhenToUse: boolean },
  check(skill, p) { /* measure, compare, emit at the severity handed in */ },
})
```

Namespaces mirror the two linters plus two special cases:

| Namespace   | Scope                                                     | Ref  |
| ----------- | --------------------------------------------------------- | ---- |
| `skill/*`   | frontmatter schema, name format + dir match, description limits, body size, link resolution, reference depth | [B1] |
| `plugin/*`  | manifest location + schema, `skills/` discovery, path containment after symlink resolution, marketplace checks, unknown fields | [B2] |
| `conflict/*`| computed **across** dialect runs, not within one (§ Union) | [B3] |
| `<vendor>/*`| vendor-only rules (e.g. `codex/skills-list-budget`), switched on solely by that vendor's dialect file | |

The plugin linter composes the skill linter: linting a plugin discovers its skills per
the active dialect's discovery rules and feeds each through `skill/*` `[A1] [A2]`. A
skill gets the same judgement whether linted alone or inside a plugin.

## Dialects

### Data files

A vendor dialect in full — this is the entire cost of supporting Codex:

```ts
// src/dialects/codex/2026-09.ts — frozen after release
export default defineDialect({
  id: "codex@2026-09",
  extends: "spec@1.0.0",
  meta: {
    source: "openai/codex codex-rs/ext/skills/src/render.rs",
    note: "verified against codex-cli 0.152.0 + source: descriptions >1024 chars are
           silently truncated with '...', not rejected (chars, not bytes); the listing
           budget is context-window-relative (2%, approx tokens = bytes/4; fallback
           8,000 chars) and shortens the longest descriptions first; SKILL.md body is
           hard-truncated at 8,000 BYTES on activation (MAX_SKILL_PROMPT_BYTES);
           names are enforced at 64 chars",
  },
  rules: {
    "skill/description-length": { severity: "warn" },             // truncation, not rejection
    "codex/skill-body-budget":  { severity: "warn", maxBytes: 8000 }, // body silently cut at activation
    "codex/skills-list-budget": { severity: "warn", max: 8000 },  // advisory: machine-dependent
  },
})
```

Everything unstated inherits from the base. To understand a dialect you read one short
delta file and the spec.

### Versioning: two clocks, one registry

| Dialect         | Kind   | Version scheme                                   | Ground truth |
| --------------- | ------ | ------------------------------------------------ | ------------ |
| `agentskills`   | spec   | semver — the spec's own (`1.0.0`)                | agentskills.io normative text |
| `agent-plugins` | spec   | semver — pinned by `$schema` URL                 | vendored official JSON Schemas |
| `claude-code`   | vendor | date snapshot (`2026-09`) — unversioned upstream | code.claude.com docs + observed behavior |
| `codex`         | vendor | date snapshot                                    | openai/codex source + docs |

Spec and vendor formats genuinely version differently; the registry absorbs the
asymmetry rather than inventing fake versions.

### Aliases

Bare names resolve at run time: `claude` → `claude-code@<newest snapshot>`, `spec` →
both spec dialects at latest, `all` → every registered dialect. Aliases move only on a
minor release of the tool, and resolved versions are always printed in the report
header — no silent drift. CI that must not move pins exact versions in config `[A5]`.

## Union semantics `[B3]`

Selecting several dialects means "my artifact must satisfy each of them":

1. Each dialect judges independently; findings carry dialect tags; identical findings
   are deduplicated by the reporter layer.
2. Exit is non-zero if **any** selected dialect has errors.
3. A **cross-run conflict pass** executes after all dialect runs and compares result
   sets — the one component that sees more than one run. Canonical case: manifest
   location (`agent-plugins` requires `./plugin.json`; Claude Code reads
   `.claude-plugin/plugin.json`). It emits ordinary diagnostics (`conflict/*`) whose
   messages state the resolution ("ship both manifests"), not just the clash.

No dialect run knows about the others; joint unsatisfiability is only computable across
results, which is why `conflict/*` is a separate pass rather than a rule.

## CLI and Action `[A4]`

One command; the target detector decides the path (SKILL.md at root → skill linting;
`plugin.json` / `.claude-plugin/` → plugin linting, which fans out per skill):

```
avocetta [paths...]               # zero-config: spec + detected vendor dialects
  --dialect claude,codex      # narrow or pin the target set (accepts name@version)
  --strict                    # warnings become errors
  --pedantic                  # enable the opinion tier
  --format text|json|sarif    # default: text on TTY, github annotations in Actions
```

Zero-config detection also picks dialects: `.claude-plugin/` present enables `claude`;
spec dialects always run. The optional config file has two jobs — CI reproducibility and
suppression — and is capped at five keys by policy `[B6]`:

```jsonc
// avocetta.config.json
{
  "dialects": ["claude@2026-09", "codex@2026-09"],
  "ignore": ["plugin/version-missing"],   // rule ids, optionally "rule@path"
  "pedantic": true
}
```

Distribution: published to npm, so `npx avocetta` covers the ad-hoc local use
case with no prior installation. The GitHub Action is the same binary with defaults
turned up: no inputs → detection,
SARIF-based PR annotations, fail on errors. Every CLI flag maps to an Action input of
the same name. It is a JS action running from committed `dist/` (a CI job rebuilds and
diffs `dist/` to keep it honest).

Deliberately **not** on the surface: rule parameters, `extends` chains, custom rules,
plugin APIs, formatter plugins. New rules and dialects arrive as PRs here, versioned
with the tool.

## Extension paths

The modularity claim, stated as procedures:

- **New rule:** add a file under `src/rules/`, reference it from the dialect files that
  enable it, add fixtures. No engine changes.
- **New dialect version** (e.g. `claude-code@2027-01`): add a frozen delta file next to
  the old one; new logic (not just parameters) lands as a rule switched on only by the
  new file; fixtures prove each delta while the old snapshot's fixtures keep passing;
  bump the alias in a minor release. Pinned users are untouched; `diff 2026-09.ts
  2027-01.ts` is the changelog.
- **New runtime** (e.g. Cursor): a new dialect directory with one snapshot file
  extending a spec base, plus any vendor-only rules and fixtures. The engine, existing
  rules, and existing dialects are untouched `[B7]`.
- **New spec version** (`agentskills@1.1.0`): a new spec base file; vendor snapshots
  choose when to re-base their `extends`.
- **New output format:** a new reporter consuming `Diagnostic[]`. Nothing upstream
  changes.

## Repository layout

```
avocetta/
├── src/
│   ├── engine/            # detect, parse once, run dialects, collect
│   ├── rules/             # skill/* · plugin/* · conflict/* · vendor-only
│   ├── dialects/          # frozen data files + alias registry
│   │   ├── spec/          #   agentskills/1.0.0.ts · agent-plugins/1.0.0.ts
│   │   ├── claude-code/   #   2026-09.ts · (later) 2027-01.ts
│   │   └── codex/         #   2026-09.ts
│   ├── schemas/           # vendored agent-plugins JSON Schemas (spec forbids runtime fetch)
│   ├── reporters/         # text · json · sarif · github-annotations
│   └── cli.ts             # util.parseArgs — no CLI framework
├── action.yml             # JS action → committed dist/
├── dist/
└── test/fixtures/         # corpora per dialect version — the real asset
```

One package; no monorepo until it demonstrably hurts.

## Dependencies

TypeScript on Node ≥ 20, ESM only. Six runtime dependencies:

| Dep                       | Why |
| ------------------------- | --- |
| `yaml`                    | the one YAML parser with source positions |
| `remark-parse` + `unified`| markdown AST with positions |
| `ajv`                     | validates vendored official JSON Schemas as-is |
| `picocolors`              | terminal color, 3 KB |

Hand-rolled because smaller than any dependency: SARIF emission, argument parsing
(`util.parseArgs`). **No tokenizer:** the spec's "<5000 tokens" guidance is a
recommendation, satisfied by the 500-line rule plus a chars/4 estimate with headroom.

Tooling: `vitest` (fixtures + snapshot diagnostics), `biome` (lint/format), `tsup`
(single-file `dist/`), `changesets` (npm publish + floating `v1` Action tag).

## Testing strategy

- **Fixture corpora per dialect version**: directories of valid/broken skills and
  plugins; tests snapshot the full diagnostic output. A frozen dialect's fixtures never
  change — that is the regression proof for the append-only invariant.
- **Conformance cross-check**: the `skill/*` rules are run against the same corpus as
  the upstream `skills-ref` reference validator; divergences must be explained (either
  our bug, or a documented spec-vs-reference gap).
- **Real-world corpus**: a handful of published plugins vendored as fixtures to catch
  rules that are technically right but practically noisy.

# Test suite guide

Policy lives in [AGENTS.md](../AGENTS.md): 100% code coverage on all four metrics and
100% use-case coverage — every use case and requirement in
[docs/product.md](../docs/product.md) has an e2e test driving the real CLI surface.
This file maps the territory: what each suite covers, and which cases and rules each
fixture exists for.

## Suites

| Suite | Level | Covers |
|---|---|---|
| `e2e.test.ts` | end-to-end (argv → exit code + rendered output) | every product use case, all target shapes, dialects, formats, flags, config, error paths, and the bin shim |
| `skill-rules.test.ts` | engine (`lint()` helper) | each `skill/*` rule against its minimal fixture |
| `plugin-rules.test.ts` | engine | each `plugin/*` structural rule, dialect tagging |
| `vendor-dialects.test.ts` | engine | claude-code and codex dialect deltas, union semantics, cross-dialect merging |
| `real-repos.test.ts` | engine | frozen copies of the two first-user repos (see *Real fixtures*) |
| `unit-edges.test.ts` | unit | edges no fixture can reach: diagnostic ordering, registry resolution, frontmatter parsing corners, rule-parameter plumbing |

## E2e case inventory

Grouped by the product requirement they exercise (`vitest list` prints the live truth;
this is the map):

- **Local check, every target shape (A1, A2)** — a skill directory, a bare `SKILL.md`
  path, a directory of skills, a plugin with its skills, a marketplace repo (local
  sources followed, remote skipped).
- **Cross-runtime compatibility (A3)** — vendor-dialect auto-detection from layout,
  explicit/repeated `--dialect` flags and aliases, Claude's combined
  description + `when_to_use` truncation, dual-layout conflict guidance in both
  directions, unknown-dialect rejection.
- **CI gate (A4)** — GitHub annotations with positions for errors and warnings,
  github-format default inside Actions, explicit format winning over that default.
- **Pre-publish audit (A5, B4, B5, B6)** — config file (pinned dialects, ignore list,
  pedantic), CLI-over-config precedence, `--strict` promotion leaving errors untouched,
  multi-path runs, cwd default, SARIF (rule metadata, default and real positions), JSON.
- **Codex budgets** — skills-listing budget, `.agents` drift only under `--pedantic`,
  silence without an `.agents` directory.
- **Claude marketplace validation** — reserved names, owner/name/source violations,
  non-kebab and non-array shapes, unparseable JSON, component dirs inside
  `.claude-plugin/`.
- **Skill frontmatter edges** — over-long names/compatibility, non-string fields,
  unterminated and unrecoverable YAML (alias bomb; syntax error + unrecoverable data),
  errors-only text output, cwd-rooted findings, unparseable plugin.json.
- **CLI surface** — `--help`, `--version`, unknown format, missing path, non-SKILL.md
  file, empty directory; the **bin shim** success and error paths.
- **Manifest coherence** — the nine-case matrix (see the `coherence/` fixtures below).

## Fixture catalog

### `fixtures/skills/` — one skill, one defect

| Fixture | Encodes | Rules / cases |
|---|---|---|
| `valid` | happy path | clean runs, format tests, cwd default |
| `Bad--Name` | invalid name grammar (dir matches, so only one finding) | `skill/name-format` |
| `mismatch` | frontmatter name ≠ directory | `skill/name-format` |
| `aaaa…` (70 chars) | name over the 64-char cap | `skill/name-format` |
| `long-desc` | 1100-char description, positioned at 3:14 | `skill/description-length` (spec error, codex warn), position plumbing, github default format |
| `long-body` | 505 lines | `skill/body-size`, `--strict`, cross-dialect merge, plural summary |
| `when-to-use-long` | description + `when_to_use` = 1601 chars | claude 1536 truncation, warn-with-position in sarif/github |
| `bad-compat` | `compatibility` at 501 chars | `skill/frontmatter-schema` |
| `non-string-fields` | numeric name/description | `skill/frontmatter-schema` |
| `no-fm` | no frontmatter at all | `skill/frontmatter-schema` |
| `unterminated` | opening `---` without a closing fence | treated as missing frontmatter |
| `alias-bomb` | `*nope` — YAML whose data is unrecoverable | error-tolerant parsing, cause reported |
| `doubly-broken` | syntax error *and* unrecoverable data | the syntax error wins the message |

`fixtures/skillset/` is the bare directory-of-skills shape (A2), with a stray
`README.md` proving non-skill children are ignored.

### `fixtures/plugins/`

| Fixture | Encodes | Rules / cases |
|---|---|---|
| `valid` | clean plugin; stray `skills/notes.txt` file | happy path, non-directory skills entries, one-sided union → `conflict/dual-layout`, `claude/manifest-layout` error |
| `no-manifest` | `skills/` with no manifest anywhere | `plugin/manifest-location`, cwd-rooted finding, sarif default position |
| `bad-manifest` | unknown field + invalid name pattern; empty `skills/junk/` | `plugin/manifest-schema` (ajv paths), `plugin/skills-discovery`, strict mixed-severity |
| `broken-json` | unparseable plugin.json | JSON parse-error reporting |
| `component-misplaced` | `skills/` inside `.claude-plugin/`; no root manifest | `claude/component-location`, the other `conflict/dual-layout` direction |
| `with-agents` | `.agents/skills` with synced, drifted, extra-only, unreadable, and empty copies | `codex/agents-dir-sync` (pedantic) and every branch of the drift comparison |
| `desc-budget` | 9 × 1000-char descriptions + one skill with none | `codex/skills-list-budget`, missing-description branch |

### `fixtures/marketplaces/`

| Fixture | Encodes | Rules / cases |
|---|---|---|
| `mixed` | local, remote (skipped), and missing-dir sources | marketplace detection, claude auto-enable, codex silence without `.agents` |
| `bad` | reserved name (`anthropic-plugins`), empty owner name, malformed entries | `claude/marketplace-schema` |
| `not-array` | non-kebab name, `plugins` not an array, no owner | `claude/marketplace-schema` |
| `no-name` | no `name` field at all | `claude/marketplace-schema` |
| `broken-json` | unparseable marketplace.json | JSON parse-error reporting |

### `fixtures/coherence/` — the manifest-coherence matrix

| Fixture | Encodes |
|---|---|
| `coherent-triple` | three manifests + self-referencing marketplace entry, all agreeing → silent |
| `version-drift-manifests` | root 1.0.0 vs `.claude-plugin` 1.1.0 → `plugin/manifest-coherence` |
| `version-drift-marketplace` | entry pins 0.9.0 vs plugin 1.0.0 → warn naming the pin |
| `name-split` | `.codex-plugin` declares a different name |
| `desc-drift` | plugin.json descriptions differ → `plugin/description-coherence`, pedantic only |
| `entry-desc-differs` | marketplace brief differs → **silent** (the documented exemption) |
| `sparse-fields` | absent / numeric fields → silent (absence is not a mismatch) |
| `non-object-vendor` | vendor manifests parsing to `[]` / `null` → ignored |
| `rootless-drift` | drift with no root manifest → finding anchors on the plugin root |

### `fixtures/config-repo/`

`avocetta.config.json` (pinned dialect, ignore list, pedantic) plus an over-long skill the
ignore list silences — the config-behavior cases (A5, B6).

### `fixtures/real/` — frozen first-user copies

Trimmed copies of the repos this linter was built for. **Frozen by policy** (AGENTS.md):
they pin historical findings even after the source repos fixed them.

| Fixture | Shape | Pins |
|---|---|---|
| `swd-mini` | dual layout: root plugin.json + marketplace `source: "./"` | the first real find — `examine`'s invalid-YAML description (a bare `: ` in a plain scalar) |
| `toastmasters-mini` | triple manifest (root + `.claude-plugin` + `.codex-plugin`) | the 11,913-byte SKILL.md over Codex's 8,000-byte cap; the codex-overlay description drift (pedantic coherence) |
| `toastmasters-root` | marketplace root + `plugins/` + a genuinely drifted `.agents/skills` copy | marketplace-scope `.agents` drift detection |

`fixtures/not-a-skill.txt` exists for the not-a-lintable-file CLI error.

## Adding to this

The definition of done for a new rule (AGENTS.md): implementation + dialect entry +
minimal fixture(s) here + an e2e case through the CLI + this file's tables updated —
with coverage still at 100%. Empty fixture directories need a `.gitkeep` (git does not
track them, and CI runs from a fresh checkout).

# avocetta — contributor guide

Deterministic linter for agent skills and plugins. What it must do:
[docs/product.md](docs/product.md) (requirements have stable IDs — cite them).
How it works: [docs/architecture.md](docs/architecture.md) (parse-once engine,
dialects as frozen data, append-only registry). Why it is this way:
[docs/decisions.md](docs/decisions.md). What each runtime actually enforces,
with evidence and re-verification recipes: [docs/dialects.md](docs/dialects.md). What changed for users, and when:
[CHANGELOG.md](CHANGELOG.md).

## Commands

- `npm run check` — typecheck + lint + tests with coverage. The pre-commit bar.
- `npm test` — tests with coverage (thresholds enforced).
- `npm run build` — bundle to `dist/` (committed; CI rebuilds and diffs it).
- `npx biome check --write src test` — format and autofix.

## Testing requirements (hard policy)

**1. 100% code coverage.** Lines, statements, functions, and branches — all 100%,
enforced by thresholds in `vitest.config.ts`; `npm test` fails below them. Rules:

- Never lower a threshold. Unreachable code is removed or restructured, not excused.
- `/* v8 ignore */` is allowed only for a defensive guard that is genuinely
  unreachable through any input, and must sit next to a comment saying why. The
  only file-level exclusion is a types-only file (nothing to instrument), declared
  in `vitest.config.ts` with its reason.

**2. 100% use-case coverage.** Every use case and requirement in `docs/product.md`
has at least one end-to-end test in `test/e2e.test.ts` that drives the real CLI
surface (argv in, exit code and rendered output out) against fixtures — not
internal APIs. Concretely, e2e coverage must span:

- every target shape: bare skill, `SKILL.md` file path, directory of skills,
  plugin (each manifest combination), marketplace repo;
- every dialect: spec pair, `claude-code`, `codex`, aliases, `name@version`
  pinning, auto-detection, and union runs including conflict guidance;
- every output format (`text`, `json`, `sarif`, `github`), both exit-code
  outcomes, `--strict`, `--pedantic`, the config file, and every CLI error path.

**3. Fixtures are the spec's test double.** Each rule behavior gets a minimal
synthetic fixture under `test/fixtures/`; `test/fixtures/real/` holds trimmed
copies of first-user repos (swd-skills, toastmasters-skills) and pins the
linter's real-world findings. Fixtures for a released dialect version are frozen
with it — a behavior change upstream means a new dialect snapshot with new
fixtures, never edits to the old ones.

**Adding a rule or dialect, definition of done:** rule implementation + dialect
data entry + synthetic fixture(s) + e2e test through the CLI + (if the rule has
parameter edges no fixture can reach) a unit test — and coverage still at 100%.

**Changelog (hard policy).** Any change that alters what avocetta flags — a new or
removed rule, a changed severity or default, an updated vendor fact, a change to
the CLI or Action surface — adds an entry under `## [Unreleased]` in
[CHANGELOG.md](CHANGELOG.md) in the same PR. Consumers pin the floating `@v1`
tag, so these reach their pipelines without them asking; the changelog is how
they find out why a build went red. A release moves that section under a version
heading, and `gh release create --notes-file` publishes the same text, so the
release notes and the changelog cannot drift. Changes that alter no diagnostic
(toolchain, tests, docs) say so explicitly rather than being omitted.

## Writing rules

- **Severity encodes enforcement, never taste** (docs/decisions.md #5): `error` =
  a runtime rejects it or a spec MUST is violated; `warn` = silent degradation or
  a spec recommendation; `pedantic: true` = opinion, off by default. A severity
  claim about a runtime needs a verified fact in docs/dialects.md behind it.
- **Messages state the consequence and the fix**, not just the violation:
  "SKILL.md is 11913 bytes, and Codex silently truncates skill contents at 8000
  bytes on activation; instructions past the cut are lost" beats "file too
  large". Include measured values and limits; carry a `range` whenever the
  parser can point at the offending value.
- Rules are dialect-blind: parameters and severity arrive resolved; never branch
  on a dialect name inside a rule.

## Releasing

Push a tag; `.github/workflows/release.yml` does the rest, deterministically.

1. Move the `## [Unreleased]` entries under a `## [X.Y.Z] - YYYY-MM-DD` heading
   in `CHANGELOG.md` and add its compare link at the bottom.
2. Bump the version in **both** `package.json` and `src/main.ts`; they must
   agree with the tag or the workflow refuses to release.
3. `npm run check && npm run build`, then commit (`dist/` is committed).
4. `git tag -a vX.Y.Z -m "avocetta X.Y.Z" && git push && git push --tags`.

The workflow verifies the tag against both version sources, requires a non-empty
changelog section, runs the full gate, rebuilds and diffs `dist/`, and only then
creates the GitHub release from that changelog section, moves the floating major
tag, and publishes to npm through OIDC trusted publishing. npm publish is last
because a version number is permanent; if it fails, everything else is already
correct and `npm publish` locally is the fallback.

A `X.Y.Z-rc.N` tag is treated as a prerelease: flagged on GitHub, published under
the npm `next` dist-tag, and never promoted to the floating major tag.

## Conventions

- npm (lockfile committed), TypeScript strict, ESM only, Node >= 20.
- Six runtime dependencies is the budget; hand-roll anything smaller than the
  dependency that would replace it. No network at lint time — schemas are
  vendored.
- Dialect data files are append-only after release; vendor facts carry their
  source citation in `meta` (runtime source file, docs URL, or a verified
  experiment).
- Commits follow Conventional Commits.

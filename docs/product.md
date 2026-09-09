# avocetta — Product

## Goal

A deterministic linter that verifies agent skills and agent plugins comply with the open
specs ([agentskills.io](https://agentskills.io/specification),
[agent-plugins.org](https://agent-plugins.org/)) and with the enforcement of specific
runtimes ([Claude Code](https://code.claude.com/docs/en/plugins-reference.md),
[Codex](https://developers.openai.com/codex/skills/)) — so authors catch
incompatibilities in CI, before their users do.

## Use cases

1. **CI gate (primary).** A maintainer of a repo containing skills — packaged as a plugin
   or standalone — adds the GitHub Action with no configuration. Every PR gets inline
   annotations on violations; merges are blocked on errors.
2. **Local check (secondary).** An author runs the linter ad hoc while writing a skill or
   plugin, before pushing — same rules, same output, no CI round-trip.
3. **Cross-runtime compatibility.** An author who built for one runtime (say Claude Code)
   asks whether the same artifact will load in another (say Codex), and gets a concrete
   list of what breaks and how to fix it.
4. **Pre-publish audit.** Before listing a plugin in a marketplace, a maintainer verifies
   packaging metadata and every bundled skill in one run.

## Constraints

- **Deterministic.** Same input, same output. No LLM, no network access at lint time.
  Every error traces to a spec clause or an observed runtime behavior.
- **Facts over opinions.** Spec limits and runtime enforcement are not configurable.
  Opinion-based checks (layout, phrasing) live in an optional, all-or-nothing pedantic tier.
- **Minimal surface.** Opinionated over configurable: fully usable with zero
  configuration, and must never grow ESLint-style configurability.
- **CI-first.** Zero-install, zero-config use in GitHub Actions must be the happy path.

## A-level requirements

- **[A1] Plugin linting.** Given a plugin directory, validate its packaging (manifest,
  layout, marketplace metadata) and every skill it contains. Plugin linting includes
  skill linting. A marketplace-shaped repo (a marketplace manifest whose entries point
  at plugin directories) is linted by validating the marketplace metadata and each
  referenced plugin.
- **[A2] Skill linting.** Given a standalone skill (or a directory of skills), validate it
  identically to a skill inside a plugin.
- **[A3] Dialects.** Compliance targets are selectable and unionable: the open specs,
  Claude Code, Codex — each versioned. With no flags, the tool auto-detects sensible
  targets (specs always; vendor dialects when their layout is present).
- **[A4] Delivery.** Primary: a GitHub Action that works with zero inputs, annotates PR
  diffs, and fails the job on errors. Secondary: a CLI runnable ad hoc, without prior
  installation.
- **[A5] Reproducibility.** A pinned dialect version yields identical results across tool
  updates; unpinned runs always report which versions they resolved to.

## B-level requirements

### [B1] Skill checks
Frontmatter schema and field constraints (name format, name-matches-directory,
description length per dialect — including per-runtime truncation behavior such as
Claude Code's combined `description` + `when_to_use` display cut and Codex's silent
truncation at 1024 characters), body size recommendations, relative
link resolution, reference-depth and layout warnings.

### [B2] Plugin checks
Manifest location and schema per dialect (`./plugin.json` for agent-plugins,
`.claude-plugin/plugin.json` for Claude Code), skill discovery under `skills/`, path
containment after symlink resolution, `marketplace.json` validation, unknown-field
warnings with typo suggestions, and metadata coherence across a plugin's manifests
(name and version must agree between the root, vendor, and marketplace declarations;
descriptions may only drift knowingly).

### [B3] Union semantics
Each selected dialect judges independently; findings are tagged with the objecting
dialect(s) and deduplicated when identical. A cross-dialect pass detects joint
unsatisfiability (e.g. conflicting manifest locations) and reports it with the concrete
resolution. Exit is non-zero if any selected dialect has errors.

### [B4] Severity model
`error` = a runtime rejects it or a spec MUST is violated; `warn` = degradation or a spec
recommendation. A strict mode promotes warnings to errors.

### [B5] Output
Human-readable text (default on a TTY), JSON, SARIF, and GitHub annotations (default in
Actions).

### [B6] Suppression
False positives and intentional deviations can be suppressed by rule id (optionally
scoped to a path). This is the only escape hatch; rule parameters are never overridable.

### [B7] Evolution
New runtime and spec versions are supported alongside existing ones, never by changing
them: results for a pinned version never change, and adding a version or a new runtime
must not require users to migrate anything.

## Non-goals

- Judging semantic quality (does the description *trigger* well) — that requires an LLM
  and belongs to eval tooling, not a linter.
- Custom rules, rule plugins, shareable configs, or an `extends` mechanism.
- Installing, packaging, or publishing skills/plugins; this tool only verifies.

## References

- [Agent Skills specification](https://agentskills.io/specification) — skill format
  (SKILL.md frontmatter, naming, layout)
- [Agent Plugins specification](https://agent-plugins.org/) — plugin packaging
  (`plugin.json`, `mcp.json`, official JSON Schemas)
- [Claude Code plugins reference](https://code.claude.com/docs/en/plugins-reference.md)
  and [skills guide](https://code.claude.com/docs/en/skills.md) — vendor format and limits
- [Codex skills](https://developers.openai.com/codex/skills/) — vendor enforcement

How these are met is described in [architecture.md](architecture.md).

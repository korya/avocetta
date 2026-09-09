import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/main.js";
import { fixtures } from "./helpers.js";

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Color codes vary by environment (CI runners set CI=true, enabling them); strip
 * them so assertions hold everywhere. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control chars
const ANSI = /\x1b\[[0-9;]*m/g;

/** End-to-end through main(): real argv, real fs, captured output. */
function cli(args: string[], opts: { cwd?: string } = {}): CliResult {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((s) => out.push(String(s)));
  const errSpy = vi.spyOn(console, "error").mockImplementation((s) => err.push(String(s)));
  const prevCwd = process.cwd();
  try {
    if (opts.cwd) process.chdir(opts.cwd);
    const code = main(args);
    return {
      code,
      stdout: out.join("\n").replace(ANSI, ""),
      stderr: err.join("\n").replace(ANSI, ""),
    };
  } finally {
    process.chdir(prevCwd);
    logSpy.mockRestore();
    errSpy.mockRestore();
  }
}

const fx = (p: string) => join(fixtures, p);

// Tests must behave identically on a dev machine and inside GitHub Actions,
// where the runner itself sets GITHUB_ACTIONS=true and would flip the default
// output format. Tests that want Actions behavior stub it to "true" themselves.
beforeEach(() => {
  vi.stubEnv("GITHUB_ACTIONS", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("use case: local check of every target shape (A1, A2)", () => {
  it("lints a skill directory", () => {
    const r = cli([fx("skills/valid")]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("no problems found");
  });

  it("lints a SKILL.md file path directly", () => {
    const r = cli([fx("skills/valid/SKILL.md")]);
    expect(r.code).toBe(0);
  });

  it("lints a bare directory of skills", () => {
    const r = cli([fx("skillset")]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("agentskills@1.0.0");
  });

  it("lints a plugin and every skill inside it", () => {
    const r = cli([fx("plugins/bad-manifest")]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("plugin/manifest-schema");
    expect(r.stdout).toContain("plugin/skills-discovery");
  });

  it("lints a marketplace repo, following local sources and skipping remote ones", () => {
    const r = cli([fx("marketplaces/mixed")]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("claude-code@2026-09"); // marketplace ⇒ claude auto-enabled
  });
});

describe("use case: cross-runtime compatibility (A3)", () => {
  it("auto-enables vendor dialects from layout evidence", () => {
    const r = cli([fx("real/toastmasters-mini")]);
    expect(r.stdout).toContain("claude-code@2026-09");
    expect(r.stdout).toContain("codex@2026-09");
  });

  it("accepts explicit dialects, including repeated flags and aliases", () => {
    const r = cli(["--dialect", "spec", "--dialect", "codex", fx("skills/valid")]);
    expect(r.stdout).toContain("codex@2026-09");
  });

  it("reports Claude's combined description + when_to_use truncation", () => {
    const r = cli(["--dialect", "claude", fx("skills/when-to-use-long")]);
    expect(r.code).toBe(0); // warn, not error
    expect(r.stdout).toContain("description + when_to_use is 1601 chars (max 1536)");
  });

  it("explains the dual-layout resolution when one union side is unsatisfied", () => {
    const r = cli(["--dialect", "spec,claude", fx("plugins/valid")]);
    expect(r.stdout).toContain("conflict/dual-layout");
    expect(r.stdout).toContain("add .claude-plugin/plugin.json or a marketplace entry");
  });

  it("explains the dual-layout resolution in the other direction too", () => {
    const r = cli(["--dialect", "spec,claude", fx("plugins/component-misplaced")]);
    expect(r.stdout).toContain("add ./plugin.json for agent-plugins.org runtimes");
  });

  it("rejects unknown dialects with the known list", () => {
    expect(() => cli(["--dialect", "cursor", fx("skills/valid")])).toThrow(
      /unknown dialect `cursor` \(known: .*codex@2026-09/,
    );
  });
});

describe("use case: CI gate (A4)", () => {
  it("emits GitHub annotations and fails the job on errors", () => {
    const r = cli(["--format", "github", fx("plugins/no-manifest")]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("::error file=");
    expect(r.stdout).toContain("plugin/manifest-location");
  });

  it("annotates warnings with positions in github format", () => {
    const r = cli(["--format", "github", "--dialect", "claude", fx("skills/when-to-use-long")]);
    expect(r.stdout).toContain("::warning file=");
    expect(r.stdout).toContain("line=3");
  });

  it("defaults to github format inside GitHub Actions", () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    const r = cli([fx("skills/long-desc")]);
    expect(r.stdout).toContain("::error file=");
    expect(r.stdout).toContain("line=3,col=14");
  });

  it("keeps an explicitly requested format inside GitHub Actions", () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    const r = cli(["--format", "json", fx("skills/valid")]);
    expect(JSON.parse(r.stdout).summary.errors).toBe(0);
  });
});

describe("use case: pre-publish audit (A5, B4, B5, B6)", () => {
  it("honors the config file: pinned dialects, ignore list, pedantic", () => {
    const r = cli(["."], { cwd: fx("config-repo") });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("dialects: agentskills@1.0.0"); // pinned, resolved, printed
    expect(r.stdout).not.toContain("skill/body-size"); // ignored by config
  });

  it("still honors the pre-2.0 askl.config.json, and says so on stderr", () => {
    const r = cli(["."], { cwd: fx("legacy-config-repo") });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("dialects: agentskills@1.0.0"); // the old file still configures
    expect(r.stdout).not.toContain("skill/body-size");
    expect(r.stderr).toContain("askl.config.json is deprecated");
    expect(r.stderr).toContain("avocetta.config.json");
  });

  it("keeps machine formats clean when the legacy config warning fires", () => {
    const r = cli(["--format", "json", "."], { cwd: fx("legacy-config-repo") });
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow(); // the notice went to stderr
    expect(r.stderr).toContain("deprecated");
  });

  it("prefers avocetta.config.json and stays silent when both names exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "avocetta-config-"));
    cpSync(fx("config-repo"), dir, { recursive: true });
    writeFileSync(join(dir, "askl.config.json"), '{"dialects": ["agent-plugins@1.0.0"]}');
    const r = cli(["."], { cwd: dir });
    expect(r.stdout).toContain("agentskills@1.0.0"); // the new file won
    expect(r.stderr).not.toContain("deprecated");
  });

  it("lets CLI dialects override the config file", () => {
    const r = cli(["--dialect", "spec", "."], { cwd: fx("config-repo") });
    expect(r.stdout).toContain("agent-plugins@1.0.0");
  });

  it("promotes warnings to errors under --strict, leaving errors untouched", () => {
    const relaxed = cli([fx("skills/long-body")]);
    const strict = cli(["--strict", fx("skills/long-body")]);
    expect(relaxed.code).toBe(0);
    expect(strict.code).toBe(1);
    const mixed = cli(["--strict", "--format", "json", fx("plugins/bad-manifest")]);
    expect(JSON.parse(mixed.stdout).summary.warnings).toBe(0);
  });

  it("lints several paths in one run and pluralizes the summary", () => {
    const r = cli(["--dialect", "claude", fx("skills/long-body"), fx("skills/when-to-use-long")]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("2 warnings");
  });

  it("defaults to linting the current directory", () => {
    const r = cli([], { cwd: fx("skills/valid") });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("no problems found");
  });

  it("emits valid SARIF with rule metadata and default positions", () => {
    const r = cli(["--format", "sarif", fx("plugins/no-manifest")]);
    const sarif = JSON.parse(r.stdout);
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].tool.driver.rules.length).toBeGreaterThan(0);
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine).toBe(1);
  });

  it("maps warnings and real positions into SARIF", () => {
    const r = cli(["--format", "sarif", "--dialect", "claude", fx("skills/when-to-use-long")]);
    const result = JSON.parse(r.stdout).runs[0].results[0];
    expect(result.level).toBe("warning");
    expect(result.locations[0].physicalLocation.region.startLine).toBe(3);
  });

  it("emits machine-readable JSON", () => {
    const r = cli(["--format", "json", fx("skills/long-desc")]);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.summary.errors).toBe(1);
    expect(parsed.diagnostics[0].rule).toBe("skill/description-length");
  });
});

describe("codex-specific budgets", () => {
  it("warns when combined descriptions blow the listing budget", () => {
    const r = cli(["--dialect", "codex", fx("plugins/desc-budget")]);
    expect(r.stdout).toContain("codex/skills-list-budget");
    expect(r.stdout).toContain("~9000 chars");
  });

  it("stays quiet on a marketplace without an .agents directory", () => {
    const r = cli(["--pedantic", "--dialect", "codex", fx("marketplaces/mixed")]);
    expect(r.stdout).not.toContain("agents-dir-sync");
  });

  it("checks plugin-level .agents drift only under --pedantic", () => {
    const quiet = cli(["--dialect", "codex", fx("plugins/with-agents")]);
    expect(quiet.stdout).not.toContain("agents-dir-sync");
    const r = cli(["--pedantic", "--dialect", "codex", fx("plugins/with-agents")]);
    const drift = r.stdout.split("\n").filter((l) => l.includes("agents-dir-sync"));
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain("drifted");
  });
});

describe("claude marketplace validation", () => {
  it("flags reserved names, missing owner, and malformed entries", () => {
    const r = cli(["--dialect", "claude", fx("marketplaces/bad")]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("reserved by Anthropic");
    expect(r.stdout).toContain("`owner.name` is missing");
    expect(r.stdout).toContain("plugins[0]: required field `name`");
    expect(r.stdout).toContain("plugins[1]: name `Bad_Name` must be kebab-case");
    expect(r.stdout).toContain("plugins[2]: required field `source`");
  });

  it("flags non-kebab names and non-array plugins", () => {
    const r = cli(["--dialect", "claude", fx("marketplaces/not-array")]);
    expect(r.stdout).toContain("must be kebab-case");
    expect(r.stdout).toContain("`plugins` must be an array");
  });

  it("flags a marketplace with no name at all", () => {
    const r = cli(["--dialect", "claude", fx("marketplaces/no-name")]);
    expect(r.stdout).toContain("required field `name` is missing or empty");
  });

  it("flags unparseable marketplace JSON", () => {
    const r = cli(["--dialect", "claude", fx("marketplaces/broken-json")]);
    expect(r.stdout).toContain("marketplace.json is not valid JSON");
  });

  it("flags component directories inside .claude-plugin/", () => {
    const r = cli(["--dialect", "claude", fx("plugins/component-misplaced")]);
    expect(r.stdout).toContain("claude/component-location");
    expect(r.stdout).toContain("`skills/` must live at the plugin root");
  });
});

describe("skill frontmatter edges", () => {
  it("rejects names over 64 chars", () => {
    const r = cli([fx(`skills/${"a".repeat(70)}`)]);
    expect(r.stdout).toContain("name is 70 chars (max 64)");
  });

  it("rejects non-string name and description", () => {
    const r = cli(["--format", "json", fx("skills/non-string-fields")]);
    const rules = JSON.parse(r.stdout).diagnostics.map((d: { message: string }) => d.message);
    expect(rules).toContainEqual(expect.stringContaining("`name` must be a non-empty string"));
    expect(rules).toContainEqual(
      expect.stringContaining("`description` must be a non-empty string"),
    );
  });

  it("rejects compatibility over 500 chars", () => {
    const r = cli([fx("skills/bad-compat")]);
    expect(r.stdout).toContain("`compatibility` is 501 chars (spec max 500)");
  });

  it("treats unterminated frontmatter as missing", () => {
    const r = cli([fx("skills/unterminated")]);
    expect(r.stdout).toContain("missing YAML frontmatter");
  });

  it("survives frontmatter whose data is unrecoverable (unresolved alias)", () => {
    const r = cli([fx("skills/alias-bomb")]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("not valid YAML");
  });

  it("reports the syntax error when the data is also unrecoverable", () => {
    const r = cli([fx("skills/doubly-broken")]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("Nested mappings are not allowed");
  });

  it("plain text output covers errors-only runs and cwd-rooted findings", () => {
    const errorsOnly = cli([fx("skills/long-desc")]);
    expect(errorsOnly.stdout).toContain("1 error · 0 warnings");
    const cwdRooted = cli([], { cwd: fx("plugins/no-manifest") });
    expect(cwdRooted.stdout).toMatch(/^\.$/m); // finding anchored at the linted root
    const cwdConflict = cli(["--dialect", "spec,claude"], { cwd: fx("plugins/valid") });
    expect(cwdConflict.stdout).toContain("conflict/dual-layout");
  });

  it("flags unparseable plugin.json", () => {
    const r = cli([fx("plugins/broken-json")]);
    expect(r.stdout).toContain("plugin.json is not valid JSON");
  });
});

describe("CLI surface", () => {
  it("--help documents the whole surface", () => {
    const r = cli(["--help"]);
    expect(r.code).toBe(0);
    for (const flag of ["--dialect", "--strict", "--pedantic", "--format"]) {
      expect(r.stdout).toContain(flag);
    }
  });

  it("--version prints the version", () => {
    const r = cli(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("rejects unknown formats", () => {
    const r = cli(["--format", "xml", fx("skills/valid")]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown format `xml`");
  });

  it("errors on a path that does not exist", () => {
    expect(() => cli([fx("no/such/path")])).toThrow(/path not found/);
  });

  it("errors on a file that is not SKILL.md", () => {
    expect(() => cli([fx("not-a-skill.txt")])).toThrow(/not a lintable file/);
  });

  it("errors on a directory with nothing to lint", () => {
    const empty = mkdtempSync(join(tmpdir(), "asl-empty-"));
    expect(() => cli([empty])).toThrow(/nothing to lint/);
  });
});

describe("bin shim (src/cli.ts)", () => {
  const runShim = async (argv: string[]) => {
    const prevArgv = process.argv;
    const prevExit = process.exitCode;
    process.argv = [process.argv[0]!, "cli.js", ...argv];
    vi.resetModules();
    try {
      await import("../src/cli.js");
      return process.exitCode;
    } finally {
      process.argv = prevArgv;
      process.exitCode = prevExit;
    }
  };

  it("runs main and sets the exit code", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await runShim(["--version"])).toBe(0);
    logSpy.mockRestore();
  });

  it("reports errors on stderr and exits 2", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runShim([fx("no/such/path")])).toBe(2);
    expect(errSpy.mock.calls[0]?.[0]).toContain("avocetta:");
    errSpy.mockRestore();
  });
});

describe("manifest coherence across a plugin's metadata declarations", () => {
  const rules = (r: CliResult) =>
    (JSON.parse(r.stdout).diagnostics as { rule: string; message: string }[]).filter((d) =>
      d.rule.includes("coherence"),
    );
  const co = (name: string, flags: string[] = []) =>
    rules(cli(["--format", "json", ...flags, fx(`coherence/${name}`)]));

  it("stays silent when every declaration agrees", () => {
    expect(co("coherent-triple")).toEqual([]);
  });

  it("warns on version drift between manifests, naming both declarations", () => {
    const out = co("version-drift-manifests");
    expect(out).toHaveLength(1);
    expect(out[0]?.rule).toBe("plugin/manifest-coherence");
    expect(out[0]?.message).toContain("plugin.json declares `1.0.0`");
    expect(out[0]?.message).toContain(".claude-plugin/plugin.json declares `1.1.0`");
  });

  it("warns when the marketplace entry pins a different version", () => {
    const out = co("version-drift-marketplace");
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain("marketplace entry declares `0.9.0`");
    expect(out[0]?.message).toContain("pinned version");
  });

  it("warns on a split name", () => {
    const out = co("name-split");
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain("name differs across manifests");
  });

  it("flags description drift only in pedantic mode", () => {
    expect(co("desc-drift")).toEqual([]);
    const out = co("desc-drift", ["--pedantic"]);
    expect(out).toHaveLength(1);
    expect(out[0]?.rule).toBe("plugin/description-coherence");
  });

  it("never compares the marketplace entry's standalone brief", () => {
    expect(co("entry-desc-differs", ["--pedantic"])).toEqual([]);
  });

  it("treats absent or non-string fields as no declaration at all", () => {
    expect(co("sparse-fields", ["--pedantic"])).toEqual([]);
    expect(co("non-object-vendor", ["--pedantic"])).toEqual([]);
  });

  it("anchors findings on the plugin root when there is no root manifest", () => {
    const out = co("rootless-drift");
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain("rootless-a");
  });

  it("pins the accepted variance: toastmasters' codex overlay description differs", () => {
    const out = rules(cli(["--format", "json", "--pedantic", fx("real/toastmasters-mini")]));
    expect(out).toHaveLength(1);
    expect(out[0]?.rule).toBe("plugin/description-coherence");
  });
});

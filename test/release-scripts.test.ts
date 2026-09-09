import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The release workflow runs these scripts before anything irreversible, so their
// failure modes matter as much as their happy paths.
interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function run(script: string, args: string[]): Run {
  try {
    const stdout = execFileSync("node", [`scripts/${script}`, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, stdout: e.stdout, stderr: e.stderr };
  }
}

const fixtureChangelog = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "avocetta-changelog-"));
  const path = join(dir, "CHANGELOG.md");
  writeFileSync(path, body);
  return path;
};

describe("changelog-section.mjs", () => {
  it("extracts the section for a released version", () => {
    const r = run("changelog-section.mjs", ["0.3.0"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("plugin/manifest-coherence");
    expect(r.stdout).not.toContain("## ["); // stops at the next version heading
  });

  it("stops the last section before the link-reference block", () => {
    const r = run("changelog-section.mjs", ["0.1.0"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Four compliance dialects");
    expect(r.stdout).not.toContain("https://github.com/korya/avocetta/compare");
  });

  it("fails on a version with no section", () => {
    const r = run("changelog-section.mjs", ["9.9.9"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no section for version 9.9.9");
  });

  it("fails on a section with no content, rather than publishing empty notes", () => {
    const path = fixtureChangelog(
      "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- thing\n",
    );
    const r = run("changelog-section.mjs", ["Unreleased", path]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("is empty");
  });

  it("reads an alternate changelog path", () => {
    const path = fixtureChangelog("## [2.0.0] - 2026-01-01\n\n### Removed\n\n- the old thing\n");
    const r = run("changelog-section.mjs", ["2.0.0", path]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("### Removed\n\n- the old thing");
  });

  it("rejects being called with no version", () => {
    expect(run("changelog-section.mjs", []).code).toBe(2);
  });
});

describe("check-release-consistency.mjs", () => {
  it("passes when the tag matches every version source", () => {
    const version = JSON.parse(
      execFileSync("node", ["-p", "JSON.stringify(require('./package.json'))"], {
        encoding: "utf8",
      }),
    ).version;
    const r = run("check-release-consistency.mjs", [version]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("agrees across");
  });

  it("fails and names each disagreeing source", () => {
    const r = run("check-release-consistency.mjs", ["99.99.99"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("package.json declares");
    expect(r.stderr).toContain("src/main.ts declares");
    expect(r.stderr).toContain("tag says 99.99.99");
  });

  it("rejects being called with no version", () => {
    expect(run("check-release-consistency.mjs", []).code).toBe(2);
  });
});

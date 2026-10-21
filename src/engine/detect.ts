import { readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { MarketplaceDoc, Target } from "./model.js";
import { agentsSkillsDirOf, readManifest, readPlugin, readSkill } from "./parse.js";

function exists(path: string, kind: "file" | "dir"): boolean {
  try {
    const st = statSync(path);
    return kind === "file" ? st.isFile() : st.isDirectory();
  } catch {
    return false;
  }
}

function hasAnyPluginManifest(dir: string): boolean {
  return (
    exists(join(dir, "plugin.json"), "file") ||
    exists(join(dir, ".claude-plugin", "plugin.json"), "file") ||
    exists(join(dir, ".codex-plugin", "plugin.json"), "file")
  );
}

function isUnderClaudeDirectory(path: string): boolean {
  return resolve(path).split(sep).includes(".claude");
}

function childSkills(dir: string, vendor?: "claude-code"): Target[] {
  const skills: Target[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (exists(child, "dir") && exists(join(child, "SKILL.md"), "file")) {
      skills.push(readSkill(child, vendor));
    }
  }
  return skills;
}

function readMarketplace(root: string): MarketplaceDoc {
  const manifest = readManifest(join(root, ".claude-plugin", "marketplace.json"));
  const plugins = [];
  const json = manifest.json as { plugins?: unknown } | undefined;
  if (Array.isArray(json?.plugins)) {
    for (const entry of json.plugins) {
      const e = entry as Record<string, unknown>;
      // Only local relative sources can be linted in-repo; remote sources are skipped.
      if (typeof e.source === "string" && e.source.startsWith("./")) {
        const dir = resolve(root, e.source);
        if (exists(dir, "dir")) {
          const meta: Record<string, string> = {};
          for (const key of ["name", "version", "description"] as const) {
            if (typeof e[key] === "string") meta[key] = e[key] as string;
          }
          plugins.push(readPlugin(dir, true, meta));
        }
      }
    }
  }
  const agentsSkillsDir = agentsSkillsDirOf(root);
  return {
    kind: "marketplace",
    root,
    manifest,
    plugins,
    ...(agentsSkillsDir !== undefined ? { agentsSkillsDir } : {}),
  };
}

/**
 * Decide what a path is and produce lint targets:
 * - a SKILL.md file or a directory containing one → a skill
 * - a directory with any plugin manifest, or a manifest-less `skills/` layout → a plugin
 * - a directory with `.claude-plugin/marketplace.json` → a marketplace (lints its local plugins)
 * - a directory whose immediate children are skill directories → those skills
 */
export function detectTargets(inputPath: string): Target[] {
  const path = resolve(inputPath);

  if (exists(path, "file")) {
    if (basename(path) === "SKILL.md") {
      return [readSkill(dirname(path), isUnderClaudeDirectory(path) ? "claude-code" : undefined)];
    }
    throw new Error(`not a lintable file: ${inputPath} (expected SKILL.md or a directory)`);
  }
  if (!exists(path, "dir")) {
    throw new Error(`path not found: ${inputPath}`);
  }

  if (exists(join(path, "SKILL.md"), "file")) {
    return [readSkill(path, isUnderClaudeDirectory(path) ? "claude-code" : undefined)];
  }
  const isClaudeSkillsDir = basename(path) === "skills" && basename(dirname(path)) === ".claude";
  if (isClaudeSkillsDir) {
    const skills = childSkills(path, "claude-code");
    if (skills.length > 0) return skills;
  }
  const nestedClaudeSkills = join(path, ".claude", "skills");
  if (basename(path) === ".claude" && exists(join(path, "skills"), "dir")) {
    const skills = childSkills(join(path, "skills"), "claude-code");
    if (skills.length > 0) return skills;
  }
  // Marketplace first: a repo can be both a marketplace and a plugin (an entry
  // with source "./" points at itself); the marketplace view covers both.
  if (exists(join(path, ".claude-plugin", "marketplace.json"), "file")) {
    return [readMarketplace(path)];
  }
  if (
    basename(path) !== ".claude" &&
    (hasAnyPluginManifest(path) || exists(join(path, "skills"), "dir"))
  ) {
    return [readPlugin(path)];
  }

  if (exists(nestedClaudeSkills, "dir")) {
    const skills = childSkills(nestedClaudeSkills, "claude-code");
    if (skills.length > 0) return skills;
  }

  const skills = childSkills(path);
  if (skills.length > 0) return skills;

  throw new Error(
    `nothing to lint at ${inputPath}: no SKILL.md, plugin manifest, skills/ directory, or marketplace found`,
  );
}

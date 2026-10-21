import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { isMap, isScalar, LineCounter, parseDocument } from "yaml";
import type { Range } from "../diagnostic.js";
import type {
  Frontmatter,
  ManifestFile,
  MarketplaceEntryMeta,
  PluginDoc,
  SkillDoc,
  SkillsDirEntry,
} from "./model.js";

const FM_OPEN = /^---\r?\n/;
const FM_CLOSE = /\r?\n---(\r?\n|$)/;

export function parseFrontmatter(raw: string): Frontmatter {
  const none: Frontmatter = { present: false, data: {}, valueRange: () => undefined };
  const open = raw.match(FM_OPEN);
  if (!open) return none;
  const rest = raw.slice(open[0].length);
  const close = rest.match(FM_CLOSE);
  if (close === null || close.index === undefined) return none;
  const fmText = rest.slice(0, close.index);
  // Frontmatter text starts on line 2 of the file, column 1.
  const lineOffset = 1;

  const lc = new LineCounter();
  const doc = parseDocument(fmText, { lineCounter: lc });

  // The yaml parser recovers from many errors (e.g. a bare `: ` inside a plain
  // scalar); keep the recovered data so other rules still run, but surface the error.
  let parseError: string | undefined;
  let parseErrorRange: Range | undefined;
  const firstError = doc.errors[0];
  if (firstError) {
    // Drop the frontmatter-relative position suffix; the diagnostic range carries
    // the file-relative position instead.
    parseError = firstError.message.split("\n")[0]?.replace(/ at line \d+, column \d+:?$/, "");
    // YAMLError.pos is declared required by the yaml package, so it is always set.
    const p = lc.linePos(firstError.pos[0]);
    const pos = { line: p.line + lineOffset, col: p.col };
    parseErrorRange = { start: pos, end: pos };
  }

  let data: Record<string, unknown> = {};
  try {
    data = (doc.toJS() ?? {}) as Record<string, unknown>;
  } catch (err) {
    // Unrecoverable (e.g. an unresolved alias): data stays empty; report the cause.
    parseError ??= (err as Error).message.split("\n")[0];
  }
  const valueRange = (key: string): Range | undefined => {
    if (!isMap(doc.contents)) return undefined;
    for (const item of doc.contents.items) {
      if (!isScalar(item.key) || item.key.value !== key) continue;
      const node = isScalar(item.value) ? item.value : item.key;
      // Every node in a parsed document carries a range; the guard below exists
      // for the API contract, not for a reachable state.
      /* v8 ignore start */
      const [start, , end] = node.range ?? [];
      if (start === undefined || end === undefined) return undefined;
      /* v8 ignore stop */
      const s = lc.linePos(start);
      const e = lc.linePos(end);
      return {
        start: { line: s.line + lineOffset, col: s.col },
        end: { line: e.line + lineOffset, col: e.col },
      };
    }
    return undefined;
  };

  return {
    present: true,
    data,
    valueRange,
    ...(parseError !== undefined ? { parseError } : {}),
    ...(parseErrorRange !== undefined ? { parseErrorRange } : {}),
  };
}

export function readSkill(dir: string, vendor?: "claude-code"): SkillDoc {
  const path = join(dir, "SKILL.md");
  const raw = readFileSync(path, "utf8");
  return {
    kind: "skill",
    dir,
    path,
    dirName: basename(dir),
    fm: parseFrontmatter(raw),
    raw,
    lines: raw.split("\n").length,
    bytes: Buffer.byteLength(raw, "utf8"),
    ...(vendor === undefined ? {} : { vendor }),
  };
}

export function readManifest(path: string): ManifestFile {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { path, exists: false };
  }
  try {
    return { path, exists: true, json: JSON.parse(text) };
  } catch (err) {
    return { path, exists: true, parseError: (err as Error).message };
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function listDirNames(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

export function agentsSkillsDirOf(root: string): string | undefined {
  const dir = join(root, ".agents", "skills");
  return isDir(dir) ? dir : undefined;
}

export function readPlugin(
  root: string,
  viaMarketplace = false,
  marketplaceEntry?: MarketplaceEntryMeta,
): PluginDoc {
  const skillsDir = join(root, "skills");
  const skillsDirExists = isDir(skillsDir);
  const skillsDirEntries: SkillsDirEntry[] = [];
  const skills: SkillDoc[] = [];

  if (skillsDirExists) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      // Spec §7.1: immediate child directories only; symlinked dirs are followed.
      const dir = join(skillsDir, entry.name);
      if (!isDir(dir)) continue;
      const hasSkillMd = isFile(join(dir, "SKILL.md"));
      skillsDirEntries.push({ name: entry.name, dir, hasSkillMd });
      if (hasSkillMd) skills.push(readSkill(dir));
    }
  }

  const agentsSkillsDir = agentsSkillsDirOf(root);
  return {
    kind: "plugin",
    root,
    agentPlugins: readManifest(join(root, "plugin.json")),
    claudePlugin: readManifest(join(root, ".claude-plugin", "plugin.json")),
    codexPlugin: readManifest(join(root, ".codex-plugin", "plugin.json")),
    viaMarketplace,
    ...(marketplaceEntry !== undefined ? { marketplaceEntry } : {}),
    claudePluginDirEntries: listDirNames(join(root, ".claude-plugin")),
    ...(agentsSkillsDir !== undefined ? { agentsSkillsDir } : {}),
    skillsDirExists,
    skillsDirEntries,
    skills,
  };
}

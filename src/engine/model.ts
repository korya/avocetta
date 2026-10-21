import type { Range } from "../diagnostic.js";

export interface Frontmatter {
  present: boolean;
  parseError?: string;
  parseErrorRange?: Range;
  data: Record<string, unknown>;
  /** Range of a top-level key's value in SKILL.md coordinates (1-based). */
  valueRange: (key: string) => Range | undefined;
}

export interface SkillDoc {
  kind: "skill";
  /** Absolute path of the skill directory. */
  dir: string;
  /** Absolute path of SKILL.md. */
  path: string;
  dirName: string;
  fm: Frontmatter;
  raw: string;
  lines: number;
  bytes: number;
  /** The vendor layout that made this skill discoverable, when known. */
  vendor?: "claude-code";
}

export interface ManifestFile {
  /** Absolute path where this manifest is expected. */
  path: string;
  exists: boolean;
  json?: unknown;
  parseError?: string;
}

export interface MarketplaceEntryMeta {
  name?: string;
  version?: string;
  description?: string;
}

export interface SkillsDirEntry {
  name: string;
  dir: string;
  hasSkillMd: boolean;
}

export interface PluginDoc {
  kind: "plugin";
  root: string;
  /** <root>/plugin.json — agent-plugins.org manifest. */
  agentPlugins: ManifestFile;
  /** <root>/.claude-plugin/plugin.json — Claude Code manifest. */
  claudePlugin: ManifestFile;
  /** <root>/.codex-plugin/plugin.json — Codex overlay manifest. */
  codexPlugin: ManifestFile;
  /** True when this plugin is reachable through a marketplace entry — Claude Code
   * can then discover it without a .claude-plugin/plugin.json of its own. */
  viaMarketplace: boolean;
  /** Metadata the sourcing marketplace entry declares for this plugin. The entry's
   * version pins what Claude Code users receive. */
  marketplaceEntry?: MarketplaceEntryMeta;
  /** Entry names inside <root>/.claude-plugin/ (component dirs there are a mistake). */
  claudePluginDirEntries: string[];
  /** <root>/.agents/skills if it exists — Codex repo-scope discovery dir. */
  agentsSkillsDir?: string;
  skillsDirExists: boolean;
  skillsDirEntries: SkillsDirEntry[];
  skills: SkillDoc[];
}

export interface MarketplaceDoc {
  kind: "marketplace";
  root: string;
  /** <root>/.claude-plugin/marketplace.json */
  manifest: ManifestFile;
  /** Plugins resolved from relative marketplace sources. */
  plugins: PluginDoc[];
  /** <root>/.agents/skills if it exists — Codex repo-scope discovery dir. */
  agentsSkillsDir?: string;
}

export type Target = SkillDoc | PluginDoc | MarketplaceDoc;

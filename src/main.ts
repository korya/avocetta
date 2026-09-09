import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Diagnostic } from "./diagnostic.js";
import { defaultSelection, resolveSelection } from "./dialects/registry.js";
import { detectTargets } from "./engine/detect.js";
import { run } from "./engine/run.js";
import { reportGithub } from "./reporters/github.js";
import { reportJson } from "./reporters/json.js";
import { reportSarif } from "./reporters/sarif.js";
import { reportText } from "./reporters/text.js";

const VERSION = "2.0.1";

const HELP = `avocetta: a deterministic linter for agent skills and plugins

Usage: avocetta [options] [paths...]

Options:
  --dialect <names>   comma-separated dialects to lint against
                      (spec, agentskills, agent-plugins, all, or name@version)
  --strict            treat warnings as errors
  --pedantic          enable opinion-tier warnings
  --format <name>     output format: text | json | sarif | github
                      (default: text; github annotations inside GitHub Actions)
  --version           print version
  --help              show this help

With no options, paths are auto-detected (skill, plugin, or marketplace) and
linted against the spec dialects. Optional config: avocetta.config.json
with { "dialects": [...], "ignore": [...], "pedantic": true }.`;

interface Config {
  dialects?: string[];
  ignore?: string[];
  pedantic?: boolean;
}

const CONFIG_FILE = "avocetta.config.json";
/** Pre-2.0 name. Honored for now: silently dropping a CI gate's ignore list is worse
 *  than carrying one extra read. Removed in 3.0.0. */
const LEGACY_CONFIG_FILE = "askl.config.json";

function readConfig(file: string): Config | undefined {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), file), "utf8"));
  } catch {
    return undefined;
  }
}

function loadConfig(): Config {
  const config = readConfig(CONFIG_FILE);
  if (config) return config;
  const legacy = readConfig(LEGACY_CONFIG_FILE);
  if (legacy) {
    // stderr, not a diagnostic: json/sarif stdout stays parseable, and --strict
    // cannot turn a rename notice into a red build.
    console.error(
      `warning: ${LEGACY_CONFIG_FILE} is deprecated and will be ignored in 3.0.0; ` +
        `rename it to ${CONFIG_FILE}`,
    );
    return legacy;
  }
  return {};
}

/** Vendor dialects join the default run when their layout is present in the targets. */
function detectVendors(targets: ReturnType<typeof detectTargets>): string[] {
  const vendors: string[] = [];
  const plugins = targets.flatMap((t) =>
    t.kind === "plugin" ? [t] : t.kind === "marketplace" ? t.plugins : [],
  );
  const anyMarketplace = targets.some((t) => t.kind === "marketplace");
  const anyAgentsDir = targets.some((t) => t.kind !== "skill" && t.agentsSkillsDir !== undefined);
  if (anyMarketplace || plugins.some((p) => p.claudePlugin.exists)) vendors.push("claude");
  if (anyAgentsDir || plugins.some((p) => p.codexPlugin.exists)) vendors.push("codex");
  return vendors;
}

export function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dialect: { type: "string", multiple: true },
      strict: { type: "boolean", default: false },
      pedantic: { type: "boolean", default: false },
      format: { type: "string", default: "text" },
      version: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.version) {
    console.log(VERSION);
    return 0;
  }

  const config = loadConfig();
  const paths = positionals.length > 0 ? positionals : ["."];
  const targets = paths.flatMap((p) => detectTargets(p));

  const selection = values.dialect?.flatMap((d) => d.split(",")) ?? config.dialects;
  const dialectIds = selection
    ? resolveSelection(selection)
    : defaultSelection(detectVendors(targets));

  const pedantic = values.pedantic || config.pedantic === true;
  let diagnostics = run(targets, dialectIds, { pedantic });

  const ignored = new Set(config.ignore ?? []);
  diagnostics = diagnostics.filter((d) => !ignored.has(d.rule));
  if (values.strict) {
    diagnostics = diagnostics.map(
      (d): Diagnostic => (d.severity === "warn" ? { ...d, severity: "error" } : d),
    );
  }

  const format =
    values.format !== "text" || process.env.GITHUB_ACTIONS !== "true" ? values.format : "github";
  if (format === "json") {
    console.log(reportJson(diagnostics, dialectIds));
  } else if (format === "sarif") {
    console.log(reportSarif(diagnostics, VERSION));
  } else if (format === "github") {
    console.log(reportGithub(diagnostics, dialectIds));
  } else if (format === "text") {
    console.log(reportText(diagnostics, dialectIds));
  } else {
    console.error(`unknown format \`${format}\` (expected text, json, sarif, or github)`);
    return 2;
  }

  return diagnostics.some((d) => d.severity === "error") ? 1 : 0;
}

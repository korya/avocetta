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

const VERSION = "1.0.4";

const HELP = `askl: a deterministic linter for agent skills and plugins

Usage: askl [options] [paths...]

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
linted against the spec dialects. Optional config: askl.config.json
with { "dialects": [...], "ignore": [...], "pedantic": true }.`;

interface Config {
  dialects?: string[];
  ignore?: string[];
  pedantic?: boolean;
}

function loadConfig(): Config {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "askl.config.json"), "utf8"));
  } catch {
    return {};
  }
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

/** askl is now avocetta. This is the last 1.x release: `v1` is frozen here and gets no
 *  further rules or vendor facts, so every remaining consumer has to hear about it.
 *  stderr, never stdout, so json and sarif output stays parseable and exit codes hold. */
function announceRename(): void {
  const lines = [
    "askl is now avocetta, and @korya/askl will not be updated again.",
    "  npx avocetta          (was: npx @korya/askl)",
    "  korya/avocetta@v2     (was: korya/askl@v1)",
    "  https://github.com/korya/avocetta",
  ];
  // Inside Actions a plain stderr line is buried in the log; an annotation is not.
  // Annotations are single-line, so the aligned block above would collapse into a
  // ragged run of spaces; say it as one sentence instead.
  if (process.env.GITHUB_ACTIONS === "true") {
    console.error(
      "::warning::askl is now avocetta, and @korya/askl will not be updated again. " +
        "Switch to korya/avocetta@v2, or npx avocetta. See https://github.com/korya/avocetta",
    );
  } else {
    console.error(lines.join("\n"));
  }
}

export function main(argv: string[]): number {
  announceRename();
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

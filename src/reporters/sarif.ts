import type { Diagnostic } from "../diagnostic.js";

/** Minimal valid SARIF 2.1.0 for GitHub code scanning. */
export function reportSarif(diagnostics: Diagnostic[], version: string): string {
  const ruleIds = [...new Set(diagnostics.map((d) => d.rule))].sort();
  return JSON.stringify(
    {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "avocetta",
              informationUri: "https://github.com/korya/avocetta",
              version,
              rules: ruleIds.map((id) => ({ id })),
            },
          },
          results: diagnostics.map((d) => ({
            ruleId: d.rule,
            level: d.severity === "error" ? "error" : "warning",
            message: { text: `[${d.dialects.join(", ")}] ${d.message}` },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: d.file.replaceAll("\\", "/") },
                  region: {
                    startLine: d.range?.start.line ?? 1,
                    startColumn: d.range?.start.col ?? 1,
                  },
                },
              },
            ],
          })),
        },
      ],
    },
    null,
    2,
  );
}

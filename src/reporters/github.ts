import type { Diagnostic } from "../diagnostic.js";

/** GitHub Actions workflow commands — inline PR annotations with zero dependencies. */
export function reportGithub(diagnostics: Diagnostic[], dialectIds: string[]): string {
  const out: string[] = [];
  for (const d of diagnostics) {
    const kind = d.severity === "error" ? "error" : "warning";
    const loc = [
      `file=${d.file}`,
      d.range ? `line=${d.range.start.line},col=${d.range.start.col}` : undefined,
      `title=${d.rule}`,
    ]
      .filter(Boolean)
      .join(",");
    // Workflow commands terminate at newlines; escape per GitHub's rules.
    const message = `[${d.dialects.join(", ")}] ${d.message}`
      .replaceAll("%", "%25")
      .replaceAll("\r", "%0D")
      .replaceAll("\n", "%0A");
    out.push(`::${kind} ${loc}::${message}`);
  }
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  out.push(
    `avocetta · dialects: ${dialectIds.join(", ")} · ` +
      `${errors} errors, ${diagnostics.length - errors} warnings`,
  );
  return out.join("\n");
}

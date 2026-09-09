import pc from "picocolors";
import type { Diagnostic } from "../diagnostic.js";

export function reportText(diagnostics: Diagnostic[], dialectIds: string[]): string {
  const out: string[] = [];
  out.push(`avocetta · dialects: ${dialectIds.join(", ")}`);
  out.push("");

  let file = "";
  for (const d of diagnostics) {
    if (d.file !== file) {
      file = d.file;
      out.push(pc.underline(file));
    }
    const mark = d.severity === "error" ? pc.red("✖") : pc.yellow("⚠");
    const tags = pc.dim(`[${d.dialects.join(", ")}]`);
    const loc = d.range ? pc.dim(` (${d.range.start.line}:${d.range.start.col})`) : "";
    out.push(`  ${mark} ${tags} ${d.rule}  ${d.message}${loc}`);
  }
  if (diagnostics.length > 0) out.push("");

  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  const summary =
    diagnostics.length === 0
      ? pc.green("✓ no problems found")
      : `${errors > 0 ? pc.red(`${errors} error${errors === 1 ? "" : "s"}`) : "0 errors"} · ` +
        `${warnings > 0 ? pc.yellow(`${warnings} warning${warnings === 1 ? "" : "s"}`) : "0 warnings"}`;
  out.push(summary);
  return out.join("\n");
}

import process from "node:process";
import { analyzePackageForDiagnostics } from "pkg-guard/experimental/analysis";

const expectedPackageName = "tool-call-contract";

const result = await analyzePackageForDiagnostics({
  cwd: process.cwd(),
  mode: "fast",
});

if (result.package?.name && result.package.name !== expectedPackageName) {
  throw new Error(
    `pkg-guard analyzed ${JSON.stringify(result.package.name)}, expected ${JSON.stringify(
      expectedPackageName,
    )}.`,
  );
}

const diagnostics = [...result.diagnostics].sort(compareDiagnostics);
const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");

if (diagnostics.length > 0) {
  process.stdout.write(
    `${diagnostics.map((diagnostic) => formatDiagnostic(diagnostic)).join("\n")}\n`,
  );
}

if (errors.length > 0) {
  throw new Error(
    `pkg-guard reported ${errors.length} package diagnostic error${errors.length === 1 ? "" : "s"}.`,
  );
}

process.stdout.write(
  diagnostics.length === 0
    ? "pkg-guard diagnostics passed with no findings.\n"
    : `pkg-guard diagnostics passed with ${diagnostics.length} non-error finding${
        diagnostics.length === 1 ? "" : "s"
      }.\n`,
);

function formatDiagnostic(diagnostic) {
  const fields = [
    diagnostic.id,
    diagnostic.severity,
    `layer=${diagnostic.layer}`,
    `cost=${diagnostic.cost}`,
  ];

  const location = formatLocation(diagnostic.location);
  if (location) {
    fields.push(location);
  }

  return fields.join(" ");
}

function formatLocation(location) {
  if (!location) {
    return "";
  }

  const fields = [`file=${location.file}`];

  if (location.path) {
    fields.push(`path=${location.path}`);
  }

  const range = formatRange(location.range);
  if (range) {
    fields.push(`range=${range}`);
  }

  return fields.join(" ");
}

function formatRange(range) {
  if (!range) {
    return "";
  }

  return `${formatPosition(range.start)}-${formatPosition(range.end)}`;
}

function formatPosition(position) {
  const offset = typeof position.offset === "number" ? `:${position.offset}` : "";

  return `${position.line + 1}:${position.column + 1}${offset}`;
}

function compareDiagnostics(left, right) {
  return (
    compareSeverity(left.severity, right.severity) ||
    left.id.localeCompare(right.id) ||
    compareLocation(left.location, right.location)
  );
}

function compareSeverity(left, right) {
  const rank = new Map([
    ["error", 0],
    ["warning", 1],
    ["info", 2],
  ]);

  return (rank.get(left) ?? 99) - (rank.get(right) ?? 99);
}

function compareLocation(left, right) {
  return (
    (left?.file ?? "").localeCompare(right?.file ?? "") ||
    (left?.path ?? "").localeCompare(right?.path ?? "")
  );
}

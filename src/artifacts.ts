import { createHash } from "node:crypto";
import path from "node:path";

import type { ContractRegistry } from "./registry.js";
import type { Finding } from "./reporting.js";
import { exportOpenAITool } from "./schema.js";
import { generateToolCallFixtures } from "./fixtures.js";
import type { JsonObject } from "./json-schema.js";
import type { ToolContract } from "./contracts.js";

export type GeneratedArtifactKind = "fixture" | "schema" | "doc" | "manifest";

export interface GeneratedArtifact {
  path: string;
  kind: GeneratedArtifactKind;
  content: string;
  hash: string;
}

export interface ArtifactManifest {
  schemaVersion: 1;
  generator: {
    name: "tool-call-contract";
    version: string;
  };
  generatedAt: null;
  contracts: Array<{
    name: string;
    inputHash: string;
    artifacts: string[];
  }>;
  files: Array<{
    path: string;
    kind: GeneratedArtifactKind;
    hash: string;
  }>;
}

export interface ArtifactGenerationResult {
  artifacts: GeneratedArtifact[];
  manifest: ArtifactManifest;
  findings: Finding[];
}

export interface ArtifactGenerationOptions {
  outDir?: string;
  version?: string;
}

interface ContractArtifactSet {
  contractName: string;
  artifacts: GeneratedArtifact[];
  inputHash: string;
  findings: Finding[];
}

export function generateArtifacts(
  registry: ContractRegistry,
  options: ArtifactGenerationOptions = {},
): ArtifactGenerationResult {
  const outDir = normalizeOutputDir(options.outDir ?? ".tool-call-contract");
  const version = options.version ?? "0.1.0";
  const contractSets = registry.contracts.map((contract) =>
    generateContractArtifacts(contract, registry.examplesByName.get(contract.name) ?? [], outDir),
  );
  const contractArtifacts = contractSets.flatMap((set) => set.artifacts);
  const manifestWithoutHash = createManifest({
    contractSets,
    contractArtifacts,
    version,
  });
  const manifestContent = formatJson(manifestWithoutHash);
  const manifestArtifact = createArtifact(
    joinArtifactPath(outDir, "manifest.json"),
    "manifest",
    manifestContent,
  );
  const artifacts = [...contractArtifacts, manifestArtifact];

  return {
    artifacts,
    manifest: manifestWithoutHash,
    findings: contractSets.flatMap((set) => set.findings),
  };
}

export function formatJson(value: unknown): string {
  return `${stableStringify(value, 2)}\n`;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function renderToolMarkdownDoc(input: {
  contract: ToolContract;
  jsonSchema?: JsonObject;
  validFixture?: unknown;
  invalidFixture?: unknown;
  openAiSchemaPath?: string;
}): string {
  const lines = [
    `# ${input.contract.name}`,
    "",
    input.contract.description || "_No description._",
    "",
  ];

  lines.push("## Input Fields", "");
  lines.push(...renderFieldTable(input.jsonSchema), "");

  if (input.validFixture !== undefined) {
    lines.push("## Valid Call", "", "```json", formatJson(input.validFixture).trimEnd(), "```", "");
  }

  if (input.invalidFixture !== undefined) {
    lines.push(
      "## Invalid Call",
      "",
      "```json",
      formatJson(input.invalidFixture).trimEnd(),
      "```",
      "",
    );
  }

  if (input.openAiSchemaPath) {
    lines.push("## Provider Export", "", `OpenAI schema: \`${input.openAiSchemaPath}\``, "");
  }

  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

function generateContractArtifacts(
  contract: ToolContract,
  examples: readonly unknown[],
  outDir: string,
): ContractArtifactSet {
  const fixtureSet = generateToolCallFixtures(contract, examples);
  const openAiExport = exportOpenAITool(contract);
  const findings = [...fixtureSet.findings, ...openAiExport.findings];
  const artifacts: GeneratedArtifact[] = [];
  const baseName = contract.name;

  if (fixtureSet.valid) {
    artifacts.push(
      createJsonArtifact(
        joinArtifactPath(outDir, "fixtures", `${baseName}.valid.json`),
        "fixture",
        fixtureSet.valid,
      ),
    );
  }

  if (fixtureSet.invalid) {
    artifacts.push(
      createJsonArtifact(
        joinArtifactPath(outDir, "fixtures", `${baseName}.invalid.json`),
        "fixture",
        fixtureSet.invalid,
      ),
    );
  }

  const openAiSchemaPath = joinArtifactPath(outDir, "schemas", `${baseName}.openai.json`);
  if (openAiExport.tool) {
    artifacts.push(createJsonArtifact(openAiSchemaPath, "schema", openAiExport.tool));
  }

  const doc = renderToolMarkdownDoc({
    contract,
    jsonSchema: openAiExport.tool?.parameters,
    validFixture: fixtureSet.valid,
    invalidFixture: fixtureSet.invalid,
    openAiSchemaPath: openAiExport.tool ? openAiSchemaPath : undefined,
  });
  artifacts.push(createArtifact(joinArtifactPath(outDir, "docs", `${baseName}.md`), "doc", doc));

  const inputHash = hashContent(
    formatJson({
      name: contract.name,
      description: contract.description,
      schema: openAiExport.tool?.parameters ?? null,
    }),
  );

  return {
    contractName: contract.name,
    artifacts,
    inputHash,
    findings,
  };
}

function createManifest(input: {
  contractSets: ContractArtifactSet[];
  contractArtifacts: GeneratedArtifact[];
  version: string;
}): ArtifactManifest {
  return {
    schemaVersion: 1,
    generator: {
      name: "tool-call-contract",
      version: input.version,
    },
    generatedAt: null,
    contracts: input.contractSets.map((set) => ({
      name: set.contractName,
      inputHash: set.inputHash,
      artifacts: set.artifacts.map((artifact) => artifact.path),
    })),
    files: input.contractArtifacts.map((artifact) => ({
      path: artifact.path,
      kind: artifact.kind,
      hash: artifact.hash,
    })),
  };
}

function createJsonArtifact(
  artifactPath: string,
  kind: GeneratedArtifactKind,
  value: unknown,
): GeneratedArtifact {
  return createArtifact(artifactPath, kind, formatJson(value));
}

function createArtifact(
  artifactPath: string,
  kind: GeneratedArtifactKind,
  content: string,
): GeneratedArtifact {
  return {
    path: artifactPath,
    kind,
    content,
    hash: hashContent(content),
  };
}

function renderFieldTable(schema: JsonObject | undefined): string[] {
  if (!schema || !isRecord(schema.properties)) {
    return ["No object input fields available."];
  }

  const required = new Set(stringArray(schema.required));
  const rows = Object.entries(schema.properties).map(([name, property]) => {
    const propertySchema = isRecord(property) ? property : {};
    return [
      name,
      required.has(name) ? "yes" : "no",
      describeSchemaType(propertySchema),
      describeDefault(propertySchema),
      describeEnum(propertySchema),
      typeof propertySchema.description === "string" ? propertySchema.description : "",
    ];
  });

  if (rows.length === 0) {
    return ["No input fields."];
  }

  return [
    "| Field | Required | Type | Default | Options | Description |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`),
  ];
}

function describeSchemaType(schema: JsonObject): string {
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf
      .map((entry) => (isRecord(entry) ? describeSchemaType(entry) : "unknown"))
      .join(" | ");
  }

  if (Array.isArray(schema.type)) {
    return schema.type.join(" | ");
  }

  return typeof schema.type === "string" ? schema.type : "unknown";
}

function describeDefault(schema: JsonObject): string {
  return Object.prototype.hasOwnProperty.call(schema, "default") ? inlineJson(schema.default) : "";
}

function describeEnum(schema: JsonObject): string {
  if (Array.isArray(schema.enum)) {
    return schema.enum.map(inlineJson).join(", ");
  }

  if (Object.prototype.hasOwnProperty.call(schema, "const")) {
    return inlineJson(schema.const);
  }

  return "";
}

function inlineJson(value: unknown): string {
  return JSON.stringify(value) ?? "";
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function stableStringify(value: unknown, space: number): string {
  return JSON.stringify(sortJsonValue(value), null, space);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

function normalizeOutputDir(outDir: string): string {
  return outDir.replaceAll("\\", "/").replace(/\/+$/g, "") || ".";
}

function joinArtifactPath(...parts: string[]): string {
  return path.posix.join(...parts.map((part) => part.replaceAll("\\", "/")));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

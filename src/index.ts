export {
  defineConfig,
  defineToolContract,
  type CaptureSuiteConfig,
  type DefineToolContractInput,
  type GenericNormalizationConfig,
  type NormalizationConfig,
  type RedactionConfig,
  type ToolCallContractConfig,
  type ToolContract,
  type ZodSchema,
} from "./contracts.js";
export {
  validateToolCall,
  validateToolCalls,
  type NormalizedToolCall,
  type ToolCallIssue,
  type ToolCallSource,
  type ToolCallValidationResult,
} from "./validation.js";
export {
  createCommandReport,
  createValidationReportMetadata,
  hasBlockingFailures,
  renderHumanReport,
  renderJsonReport,
  summarizeReport,
  type CommandName,
  type CommandReport,
  type Finding,
  type GeneratedTestReportMetadata,
  type ReportSummary,
  type RedactionReportMetadata,
  type Severity,
  type ValidationReportMetadata,
} from "./reporting.js";
export { ConfigLoadError, defaultConfigFiles, loadConfig, type LoadedConfig } from "./config.js";
export { createContractRegistry, type ContractRegistry } from "./registry.js";
export { runContractChecks } from "./checks.js";
export {
  analyzeContractSchema,
  analyzeRegistrySchemas,
  exportOpenAITool,
  exportOpenAITools,
  type OpenAIToolDefinition,
  type OpenAIToolExport,
  type SchemaAnalysis,
} from "./schema.js";
export {
  generateRegistryFixtures,
  generateToolCallFixtures,
  type FixtureSource,
  type ToolCallFixtureSet,
} from "./fixtures.js";
export {
  getFixtureCapabilityForJsonSchema,
  synthesizeInvalidValue,
  synthesizeValidValue,
  type JsonObject,
  type JsonSynthesisResult,
} from "./json-schema.js";
export {
  formatJson,
  generateArtifacts,
  hashContent,
  renderToolMarkdownDoc,
  type ArtifactGenerationOptions,
  type ArtifactGenerationResult,
  type ArtifactManifest,
  type GeneratedArtifact,
  type GeneratedArtifactKind,
} from "./artifacts.js";
export {
  collectArtifactFreshnessFindings,
  loadArtifactManifest,
  planArtifactWrites,
  writeArtifactPlan,
  type ArtifactManifestLoadResult,
  type ArtifactWriteAction,
  type ArtifactWritePlan,
  type ArtifactWritePlanOptions,
  type ArtifactWriteRoots,
  type PlannedArtifactDelete,
  type PlannedArtifactWrite,
} from "./artifact-writer.js";

export const version = "0.2.0";

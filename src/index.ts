export {
  defineConfig,
  defineToolContract,
  type DefineToolContractInput,
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
  hasBlockingFailures,
  renderHumanReport,
  renderJsonReport,
  summarizeReport,
  type CommandName,
  type CommandReport,
  type Finding,
  type ReportSummary,
  type Severity,
} from "./reporting.js";
export { ConfigLoadError, defaultConfigFiles, loadConfig, type LoadedConfig } from "./config.js";
export { createContractRegistry, type ContractRegistry } from "./registry.js";

export const version = "0.0.0";

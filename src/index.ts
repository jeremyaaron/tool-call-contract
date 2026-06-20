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

export const version = "0.0.0";

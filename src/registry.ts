import type { ToolCallContractConfig, ToolContract } from "./contracts.js";
import type { Finding } from "./reporting.js";

export interface ContractRegistry {
  contracts: readonly ToolContract[];
  byName: Map<string, ToolContract>;
  duplicates: Map<string, ToolContract[]>;
  examplesByName: Map<string, unknown[]>;
}

export function createContractRegistry(config: ToolCallContractConfig): {
  registry: ContractRegistry;
  findings: Finding[];
} {
  const byName = new Map<string, ToolContract>();
  const duplicateBuckets = new Map<string, ToolContract[]>();
  const examplesByName = new Map<string, unknown[]>();

  for (const contract of config.contracts) {
    const existing = byName.get(contract.name);

    if (existing) {
      const bucket = duplicateBuckets.get(contract.name) ?? [existing];
      bucket.push(contract);
      duplicateBuckets.set(contract.name, bucket);
    } else {
      byName.set(contract.name, contract);
    }

    examplesByName.set(contract.name, [
      ...(examplesByName.get(contract.name) ?? []),
      ...contract.examples,
    ]);
  }

  for (const [name, examples] of Object.entries(config.examples ?? {})) {
    examplesByName.set(name, [...(examplesByName.get(name) ?? []), ...examples]);
  }

  const findings = [...duplicateBuckets.entries()].map(([name, contracts]) => ({
    id: "contract.duplicate-name",
    severity: "error" as const,
    title: "Duplicate contract name",
    message: `${contracts.length} contracts are named "${name}".`,
    impact: "Captured calls and provider schemas cannot be mapped back to one source contract.",
    suggestion: "Rename contracts so each configured tool name is unique.",
    contractName: name,
  }));

  return {
    registry: {
      contracts: config.contracts,
      byName,
      duplicates: duplicateBuckets,
      examplesByName,
    },
    findings,
  };
}

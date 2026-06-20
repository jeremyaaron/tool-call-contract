import type { ContractRegistry } from "./registry.js";
import type { Finding } from "./reporting.js";

const providerSafeNamePattern = /^[a-zA-Z0-9_-]{1,64}$/;

export function runContractChecks(registry: ContractRegistry): Finding[] {
  return [
    ...checkProviderSafeNames(registry),
    ...checkDescriptions(registry),
    ...checkExamples(registry),
  ];
}

function checkProviderSafeNames(registry: ContractRegistry): Finding[] {
  return registry.contracts
    .filter((contract) => !providerSafeNamePattern.test(contract.name))
    .map((contract) => ({
      id: "contract.invalid-name",
      severity: "error" as const,
      title: "Contract name is not provider-safe",
      message: `Tool contract "${contract.name}" does not match /^[a-zA-Z0-9_-]{1,64}$/.`,
      impact: "Provider tool schemas may reject this name or fail to map calls back to a contract.",
      suggestion: "Use only letters, numbers, underscores, or hyphens, up to 64 characters.",
      contractName: contract.name,
    }));
}

function checkDescriptions(registry: ContractRegistry): Finding[] {
  return registry.contracts
    .filter((contract) => contract.description.trim().length === 0)
    .map((contract) => ({
      id: "contract.description-missing",
      severity: "warning" as const,
      title: "Contract description is missing",
      message: `Tool contract "${contract.name}" has no description.`,
      impact: "Generated docs and provider schemas will be less useful.",
      suggestion: "Add a concise description that tells the model when to call this tool.",
      contractName: contract.name,
    }));
}

function checkExamples(registry: ContractRegistry): Finding[] {
  const findings: Finding[] = [];

  for (const contract of registry.contracts) {
    const examples = registry.examplesByName.get(contract.name) ?? [];

    examples.forEach((example, index) => {
      const result = contract.input.safeParse(example);

      if (!result.success) {
        const firstIssue = result.error.issues[0];
        findings.push({
          id: "schema.example-invalid",
          severity: "error",
          title: "Configured example does not match the contract schema",
          message: `Example ${index + 1} for "${contract.name}" is invalid${
            firstIssue ? `: ${firstIssue.message}` : "."
          }`,
          impact: "Generated fixtures seeded from this example would not validate.",
          suggestion: "Update the example so it satisfies the tool input schema.",
          contractName: contract.name,
          path: firstIssue?.path.join("."),
        });
      }
    });
  }

  return findings;
}

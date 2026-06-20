# tool-call-contract

Define AI tool contracts once, then validate calls and generate test artifacts.

This repository is being built toward the v0.1 MVP described in:

- [PRD](docs/prd.md)
- [Technical design](docs/technical-design.md)
- [Implementation plan](docs/implementation-plan.md)

## Planned Usage

```ts
import { defineToolContract } from "tool-call-contract";
import { z } from "zod";

export const createIssue = defineToolContract({
  name: "create_issue",
  description: "Create a GitHub issue.",
  input: z.object({
    title: z.string().min(1),
    body: z.string().min(1),
    labels: z.array(z.string()).default([]),
  }),
});
```

```sh
tool-call-contract check
tool-call-contract generate
tool-call-contract validate captures/*.json
```

The current implementation is in Phase 0: repository scaffold.

import { z } from "zod";

import { defineConfig, defineToolContract } from "../../src/index.ts";

const searchKnowledgeBase = defineToolContract({
  name: "search_knowledge_base",
  description: "Search internal product documentation for a user question.",
  input: z.object({
    query: z.string().min(1),
    product: z.enum(["billing", "analytics", "platform"]),
    limit: z.number().int().min(1).max(10).default(5),
  }),
});

const createIssue = defineToolContract({
  name: "create_issue",
  description: "Create an engineering issue from a validated support escalation.",
  input: z.object({
    title: z.string().min(1),
    body: z.string().min(1),
    labels: z.array(z.string()).default([]),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
  }),
});

const summarizeThread = defineToolContract({
  name: "summarize_thread",
  description: "Summarize a customer conversation for handoff.",
  input: z.object({
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant", "system"]),
          content: z.string().min(1),
        }),
      )
      .min(1),
    maxWords: z.number().int().min(20).max(300).default(120),
  }),
});

export default defineConfig({
  contracts: [searchKnowledgeBase, createIssue, summarizeThread],
  captures: {
    smoke: ["captures/smoke/*.json"],
    regression: ["captures/regression/*.json"],
  },
  redaction: {
    paths: ["arguments.email", "metadata.authorization"],
  },
});

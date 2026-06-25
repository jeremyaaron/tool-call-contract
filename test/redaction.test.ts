import { describe, expect, it } from "vitest";

import { defaultRedactionReplacement, planRedactions, redactJsonValue } from "../src/redaction.js";

describe("planRedactions", () => {
  it("redacts nested object values with the default replacement", () => {
    const plan = planRedactions({
      files: [
        {
          file: "captures/raw.json",
          content: JSON.stringify({
            name: "create_issue",
            arguments: {
              email: "user@example.com",
              customer: {
                ssn: "123-45-6789",
              },
              title: "Bug",
            },
          }),
        },
      ],
      paths: ["arguments.email", "arguments.customer.ssn"],
    });

    expect(plan.findings).toEqual([]);
    expect(plan.entries).toEqual([
      {
        file: "captures/raw.json",
        changed: true,
        content: [
          "{",
          '  "name": "create_issue",',
          '  "arguments": {',
          `    "email": "${defaultRedactionReplacement}",`,
          '    "customer": {',
          `      "ssn": "${defaultRedactionReplacement}"`,
          "    },",
          '    "title": "Bug"',
          "  }",
          "}",
          "",
        ].join("\n"),
        replacements: 2,
        issues: [],
      },
    ]);
  });

  it("applies paths recursively inside wrapper objects", () => {
    const plan = planRedactions({
      files: [
        {
          file: "captures/wrapped.json",
          content: `${JSON.stringify(
            {
              calls: [
                {
                  name: "create_issue",
                  arguments: {
                    email: "one@example.com",
                  },
                },
                {
                  name: "create_issue",
                  arguments: {
                    email: "two@example.com",
                  },
                },
              ],
            },
            null,
            2,
          )}\n`,
        },
      ],
      paths: ["arguments.email"],
      replacement: "[SAFE]",
    });

    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]).toMatchObject({
      changed: true,
      replacements: 2,
      issues: [],
    });
    expect(plan.entries[0]?.content).toContain('"email": "[SAFE]"');
    expect(plan.entries[0]?.content).not.toContain("one@example.com");
    expect(plan.entries[0]?.content).not.toContain("two@example.com");
  });

  it("supports wildcard segments for objects and arrays", () => {
    const plan = planRedactions({
      files: [
        {
          file: "captures/openai.json",
          content: JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        arguments: {
                          apiKey: "sk-one",
                          nested: {
                            token: "token-one",
                          },
                        },
                      },
                    },
                  ],
                },
              },
            ],
            metadata: {
              authorization: "Bearer abc",
              cookie: "session=123",
            },
          }),
        },
      ],
      paths: ["choices.*.message.tool_calls.*.function.arguments.apiKey", "metadata.*"],
      replacement: "[MASKED]",
    });

    expect(plan.entries[0]).toMatchObject({
      changed: true,
      replacements: 3,
      issues: [],
    });
    expect(plan.entries[0]?.content).toContain('"apiKey": "[MASKED]"');
    expect(plan.entries[0]?.content).toContain('"authorization": "[MASKED]"');
    expect(plan.entries[0]?.content).toContain('"cookie": "[MASKED]"');
    expect(plan.entries[0]?.content).toContain('"token": "token-one"');
  });

  it("does not change files that are already redacted and formatted", () => {
    const content = ["{", '  "arguments": {', '    "email": "[REDACTED]"', "  }", "}", ""].join(
      "\n",
    );

    const plan = planRedactions({
      files: [
        {
          file: "captures/safe.json",
          content,
        },
      ],
      paths: ["arguments.email"],
    });

    expect(plan.entries).toEqual([
      {
        file: "captures/safe.json",
        changed: false,
        replacements: 0,
        issues: [],
      },
    ]);
  });

  it("preserves parsed object key order when formatting", () => {
    const plan = planRedactions({
      files: [
        {
          file: "captures/order.json",
          content: JSON.stringify({
            b: 1,
            a: {
              d: 2,
              c: 3,
            },
            arguments: {
              email: "user@example.com",
            },
          }),
        },
      ],
      paths: ["arguments.email"],
    });

    expect(plan.entries[0]?.content).toBe(
      [
        "{",
        '  "b": 1,',
        '  "a": {',
        '    "d": 2,',
        '    "c": 3',
        "  },",
        '  "arguments": {',
        '    "email": "[REDACTED]"',
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("reports malformed JSON as a file issue", () => {
    const plan = planRedactions({
      files: [
        {
          file: "captures/bad.json",
          content: "{ nope",
        },
      ],
      paths: ["arguments.email"],
    });

    expect(plan.findings).toEqual([]);
    expect(plan.entries).toMatchObject([
      {
        file: "captures/bad.json",
        changed: false,
        replacements: 0,
        issues: [
          {
            code: "file.invalid-json",
          },
        ],
      },
    ]);
  });

  it("reports invalid redaction paths as findings", () => {
    const plan = planRedactions({
      files: [
        {
          file: "captures/raw.json",
          content: "{}\n",
        },
      ],
      paths: ["arguments..email", ""],
    });

    expect(plan.findings).toMatchObject([
      {
        id: "redaction.path-invalid",
        severity: "error",
        path: "arguments..email",
      },
      {
        id: "redaction.path-invalid",
        severity: "error",
        path: "",
      },
    ]);
    expect(plan.entries).toEqual([
      {
        file: "captures/raw.json",
        changed: false,
        replacements: 0,
        issues: [],
      },
    ]);
  });
});

describe("redactJsonValue", () => {
  it("redacts parsed JSON values without mutating the input", () => {
    const value = {
      arguments: {
        email: "user@example.com",
      },
    };

    const result = redactJsonValue({
      value,
      paths: ["arguments.email"],
    });

    expect(result).toEqual({
      value: {
        arguments: {
          email: "[REDACTED]",
        },
      },
      replacements: 1,
      findings: [],
    });
    expect(value.arguments.email).toBe("user@example.com");
  });
});

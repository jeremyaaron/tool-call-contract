export type JsonObject = Record<string, unknown>;

export type JsonSynthesisResult =
  | {
      ok: true;
      value: unknown;
    }
  | {
      ok: false;
      reason: string;
    };

export function getFixtureCapabilityForJsonSchema(schema: JsonObject): "supported" | "unsupported" {
  return synthesizeValidValue(schema).ok && synthesizeInvalidValue(schema).ok
    ? "supported"
    : "unsupported";
}

export function synthesizeValidValue(schema: unknown): JsonSynthesisResult {
  const normalized = normalizeSchema(schema);
  if (!normalized.ok) {
    return normalized;
  }

  const value = synthesizeBySchema(normalized.schema);
  return value;
}

export function synthesizeInvalidValue(schema: unknown): JsonSynthesisResult {
  const normalized = normalizeSchema(schema);
  if (!normalized.ok) {
    return normalized;
  }

  return synthesizeInvalidBySchema(normalized.schema);
}

function synthesizeBySchema(schema: JsonObject): JsonSynthesisResult {
  if (hasOwn(schema, "$ref") || hasUnsupportedComposition(schema)) {
    return unsupported("Schema composition or references are not supported for fixture synthesis.");
  }

  if (hasOwn(schema, "default")) {
    return {
      ok: true,
      value: schema.default,
    };
  }

  if (hasOwn(schema, "const")) {
    return {
      ok: true,
      value: schema.const,
    };
  }

  if (Array.isArray(schema.enum)) {
    if (schema.enum.length === 0) {
      return unsupported("Empty enum cannot produce a valid fixture.");
    }

    return {
      ok: true,
      value: schema.enum[0],
    };
  }

  const nullable = unwrapNullable(schema);
  if (nullable) {
    return synthesizeBySchema(nullable);
  }

  const type = firstNonNullType(schema.type);

  switch (type) {
    case "object":
      return synthesizeObject(schema);
    case "array":
      return synthesizeArray(schema);
    case "string":
      return synthesizeString(schema);
    case "number":
      return synthesizeNumber(schema, false);
    case "integer":
      return synthesizeNumber(schema, true);
    case "boolean":
      return {
        ok: true,
        value: true,
      };
    case "null":
      return {
        ok: true,
        value: null,
      };
    default:
      return unsupported("Schema type is unsupported for fixture synthesis.");
  }
}

function synthesizeInvalidBySchema(schema: JsonObject): JsonSynthesisResult {
  if (hasOwn(schema, "const")) {
    return {
      ok: true,
      value: invalidConstValue(schema.const),
    };
  }

  if (Array.isArray(schema.enum)) {
    return {
      ok: true,
      value: "__tool_call_contract_invalid_enum__",
    };
  }

  const nullable = unwrapNullable(schema);
  if (nullable) {
    return synthesizeInvalidBySchema(nullable);
  }

  const type = firstNonNullType(schema.type);

  switch (type) {
    case "object":
      return synthesizeInvalidObject(schema);
    case "array":
      return {
        ok: true,
        value: "not-an-array",
      };
    case "string":
      return {
        ok: true,
        value: 123,
      };
    case "number":
    case "integer":
      return {
        ok: true,
        value: "not-a-number",
      };
    case "boolean":
      return {
        ok: true,
        value: "not-a-boolean",
      };
    case "null":
      return {
        ok: true,
        value: "not-null",
      };
    default:
      return unsupported("Schema type is unsupported for invalid fixture synthesis.");
  }
}

function synthesizeObject(schema: JsonObject): JsonSynthesisResult {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = stringArray(schema.required);
  const value: Record<string, unknown> = {};

  for (const key of required) {
    const propertySchema = properties[key];
    if (propertySchema === undefined) {
      return unsupported(`Required property "${key}" has no schema.`);
    }

    const propertyValue = synthesizeBySchemaObject(propertySchema);
    if (!propertyValue.ok) {
      return propertyValue;
    }

    value[key] = propertyValue.value;
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (hasOwn(value, key) || !isRecord(propertySchema) || !hasOwn(propertySchema, "default")) {
      continue;
    }

    value[key] = propertySchema.default;
  }

  return {
    ok: true,
    value,
  };
}

function synthesizeArray(schema: JsonObject): JsonSynthesisResult {
  const minItems = nonNegativeInteger(schema.minItems) ?? 0;
  const maxItems = nonNegativeInteger(schema.maxItems);

  if (maxItems !== undefined && minItems > maxItems) {
    return unsupported("Array minItems exceeds maxItems.");
  }

  if (minItems === 0) {
    return {
      ok: true,
      value: [],
    };
  }

  const itemSchema = schema.items ?? {};
  const itemValue = synthesizeBySchemaObject(itemSchema);

  if (!itemValue.ok) {
    return itemValue;
  }

  return {
    ok: true,
    value: Array.from({ length: minItems }, () => itemValue.value),
  };
}

function synthesizeString(schema: JsonObject): JsonSynthesisResult {
  if (typeof schema.pattern === "string") {
    return unsupported("String patterns are not supported for fixture synthesis.");
  }

  const minLength = nonNegativeInteger(schema.minLength) ?? 0;
  const maxLength = nonNegativeInteger(schema.maxLength);

  if (maxLength !== undefined && minLength > maxLength) {
    return unsupported("String minLength exceeds maxLength.");
  }

  if (maxLength === 0) {
    return {
      ok: true,
      value: "",
    };
  }

  const length = Math.max(minLength, 1);

  return {
    ok: true,
    value: "x".repeat(maxLength === undefined ? length : Math.min(length, maxLength)),
  };
}

function synthesizeNumber(schema: JsonObject, integer: boolean): JsonSynthesisResult {
  const minimum = numberValue(schema.minimum);
  const maximum = numberValue(schema.maximum);
  let value = minimum ?? 0;

  if (integer) {
    value = Math.ceil(value);
  }

  if (maximum !== undefined && value > maximum) {
    return unsupported("Number minimum exceeds maximum.");
  }

  return {
    ok: true,
    value,
  };
}

function synthesizeInvalidObject(schema: JsonObject): JsonSynthesisResult {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = stringArray(schema.required);

  if (required.length > 0) {
    const valid = synthesizeObject(schema);
    if (!valid.ok || !isRecord(valid.value)) {
      return {
        ok: true,
        value: {},
      };
    }

    const [firstRequired] = required;
    const value = { ...valid.value };
    if (firstRequired !== undefined) {
      delete value[firstRequired];
    }

    return {
      ok: true,
      value,
    };
  }

  const [firstPropertyName, firstPropertySchema] = Object.entries(properties)[0] ?? [];
  if (firstPropertyName && firstPropertySchema !== undefined) {
    const invalid = synthesizeInvalidBySchemaObject(firstPropertySchema);
    if (!invalid.ok) {
      return invalid;
    }

    return {
      ok: true,
      value: {
        [firstPropertyName]: invalid.value,
      },
    };
  }

  return {
    ok: true,
    value: null,
  };
}

function synthesizeBySchemaObject(schema: unknown): JsonSynthesisResult {
  const normalized = normalizeSchema(schema);
  return normalized.ok ? synthesizeBySchema(normalized.schema) : normalized;
}

function synthesizeInvalidBySchemaObject(schema: unknown): JsonSynthesisResult {
  const normalized = normalizeSchema(schema);
  return normalized.ok ? synthesizeInvalidBySchema(normalized.schema) : normalized;
}

function normalizeSchema(schema: unknown):
  | {
      ok: true;
      schema: JsonObject;
    }
  | {
      ok: false;
      reason: string;
    } {
  if (schema === true) {
    return {
      ok: true,
      schema: {},
    };
  }

  if (!isRecord(schema)) {
    return unsupportedSchema("Schema must be a JSON object.");
  }

  return {
    ok: true,
    schema,
  };
}

function unwrapNullable(schema: JsonObject): JsonObject | null {
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : undefined;
  if (anyOf) {
    const nonNullSchemas = anyOf.filter(
      (entry): entry is JsonObject => isRecord(entry) && firstNonNullType(entry.type) !== "null",
    );
    const nullSchemas = anyOf.filter(
      (entry) => isRecord(entry) && firstNonNullType(entry.type) === "null",
    );

    return nonNullSchemas.length === 1 && nullSchemas.length === 1
      ? (nonNullSchemas[0] ?? null)
      : null;
  }

  if (Array.isArray(schema.type) && schema.type.includes("null")) {
    const type = schema.type.find((entry) => entry !== "null");
    return typeof type === "string" ? { ...schema, type } : null;
  }

  return null;
}

function firstNonNullType(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.find((entry): entry is string => typeof entry === "string" && entry !== "null");
  }

  return typeof value === "string" ? value : undefined;
}

function hasUnsupportedComposition(schema: JsonObject): boolean {
  return (
    hasOwn(schema, "$ref") ||
    hasOwn(schema, "oneOf") ||
    hasOwn(schema, "allOf") ||
    hasOwn(schema, "not") ||
    hasOwn(schema, "patternProperties")
  );
}

function invalidConstValue(value: unknown): unknown {
  switch (typeof value) {
    case "string":
      return `${value}__invalid`;
    case "number":
      return String(value);
    case "boolean":
      return !value;
    default:
      return value === null ? "not-null" : null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function unsupported(reason: string): JsonSynthesisResult {
  return {
    ok: false,
    reason,
  };
}

function unsupportedSchema(reason: string): { ok: false; reason: string } {
  return {
    ok: false,
    reason,
  };
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

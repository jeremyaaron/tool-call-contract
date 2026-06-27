export interface ParsedPathSelector {
  source: string;
  segments: readonly string[];
}

export type PathSelectorParseResult =
  | {
      ok: true;
      selector: ParsedPathSelector;
    }
  | {
      ok: false;
      message: string;
    };

export type PathSelectorTarget =
  | {
      kind: "array";
      parent: unknown[];
      key: number;
    }
  | {
      kind: "object";
      parent: Record<string, unknown>;
      key: string;
    };

export function parsePathSelector(path: string): PathSelectorParseResult {
  if (path.trim().length === 0) {
    return {
      ok: false,
      message: "Path selector must be a non-empty dot path.",
    };
  }

  const segments = path.split(".");
  const emptySegmentIndex = segments.findIndex((segment) => segment.length === 0);

  if (emptySegmentIndex !== -1) {
    return {
      ok: false,
      message: `Path selector "${path}" contains an empty segment at index ${emptySegmentIndex}.`,
    };
  }

  return {
    ok: true,
    selector: {
      source: path,
      segments,
    },
  };
}

export function selectPathValues(value: unknown, selector: ParsedPathSelector): unknown[] {
  return selectPathTargets(value, selector).map(getPathTargetValue);
}

export function selectPathTargets(
  value: unknown,
  selector: ParsedPathSelector,
): PathSelectorTarget[] {
  return selectTargetsAtSegments(value, selector.segments);
}

export function getPathTargetValue(target: PathSelectorTarget): unknown {
  if (target.kind === "array") {
    return target.parent[target.key];
  }

  return target.parent[target.key];
}

export function setPathTargetValue(target: PathSelectorTarget, value: unknown): void {
  if (target.kind === "array") {
    target.parent[target.key] = value;
    return;
  }

  target.parent[target.key] = value;
}

function selectTargetsAtSegments(
  value: unknown,
  segments: readonly string[],
  index = 0,
): PathSelectorTarget[] {
  if (index >= segments.length) {
    return [];
  }

  const segment = segments[index];
  if (!segment) {
    return [];
  }

  if (index === segments.length - 1) {
    return getMatchingTargets(value, segment);
  }

  return getMatchingTargets(value, segment).flatMap((target) =>
    selectTargetsAtSegments(getPathTargetValue(target), segments, index + 1),
  );
}

function getMatchingTargets(value: unknown, segment: string): PathSelectorTarget[] {
  if (Array.isArray(value)) {
    if (segment === "*") {
      return value.map((_, index) => ({
        kind: "array",
        parent: value,
        key: index,
      }));
    }

    const index = parseArrayIndex(segment);
    return index !== undefined && index < value.length
      ? [
          {
            kind: "array",
            parent: value,
            key: index,
          },
        ]
      : [];
  }

  if (!isRecord(value)) {
    return [];
  }

  if (segment === "*") {
    return Object.keys(value).map((key) => ({
      kind: "object",
      parent: value,
      key,
    }));
  }

  return Object.prototype.hasOwnProperty.call(value, segment)
    ? [
        {
          kind: "object",
          parent: value,
          key: segment,
        },
      ]
    : [];
}

function parseArrayIndex(segment: string): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(segment)) {
    return undefined;
  }

  return Number(segment);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJson(entry));
  }

  if (value && typeof value === "object") {
    const sorted: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJson((value as Record<string, JsonValue>)[key]);
    }
    return sorted;
  }

  return value;
}

export function stableStringify(value: JsonValue): string {
  return JSON.stringify(sortJson(value));
}

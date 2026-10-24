// OpenAI strict outputs require every property to be required, including values
// that the application schema normally supplies by default.
export function strictOutputSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strictOutputSchema);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value))
    if (!["$schema", "default"].includes(k)) result[k] = strictOutputSchema(v);
  if (result.properties && typeof result.properties === "object") {
    result.required = Object.keys(result.properties);
    result.additionalProperties = false;
  }
  return result;
}

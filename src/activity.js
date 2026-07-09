export function normalizeActivity(value) {
  const normalizedValue = value ? String(value).trim() : "";
  return normalizedValue ? normalizedValue.toUpperCase() : undefined;
}

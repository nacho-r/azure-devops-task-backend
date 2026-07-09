export function normalizeActivity(value) {
  const normalizedValue = value ? String(value).trim() : "";
  return normalizedValue
    ? normalizedValue.charAt(0).toUpperCase() + normalizedValue.slice(1).toLowerCase()
    : undefined;
}

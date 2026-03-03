export function decodeQueryParam(value: string | string[] | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(normalized);
  } catch {
    return raw;
  }
}

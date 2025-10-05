export function ensureDefined<T>(value: T | null | undefined, message?: string): T {
  if (value === undefined || value === null) {
    throw new Error(message ?? 'Expected value to be defined');
  }
  return value;
}

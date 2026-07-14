declare module 'adf-to-md' {
  export function convert(adf: unknown): { result: string; warnings: Record<string, unknown> };
  export function validate(adf: unknown): { isValid: boolean };
}

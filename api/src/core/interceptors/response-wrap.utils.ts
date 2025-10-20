/**
 * Masks sensitive fields in an object by replacing their values with '***'.
 * Sensitive fields include: password, token, authorization, auth, signature.
 * The function works recursively for nested objects.
 *
 * @param obj - The object to mask.
 * @returns A new object with sensitive fields masked.
 */
export function maskSensitiveFields(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (
      ['password', 'token', 'authorization', 'auth', 'signature'].includes(
        k.toLowerCase(),
      )
    ) {
      clone[k] = '***';
    } else if (typeof v === 'object') {
      clone[k] = maskSensitiveFields(v);
    } else {
      clone[k] = v;
    }
  }
  return clone;
}

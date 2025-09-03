/**
 * JSON sanitization utilities for Claude API responses
 *
 * @deprecated These utilities are deprecated in favor of Claude tool calling.
 * Tool calling provides structured output that doesn't require JSON parsing.
 * These functions are preserved for backward compatibility only.
 *
 * Claude API sometimes returns malformed JSON with unquoted property names
 * or other formatting issues. This utility attempts to fix common issues.
 */

/**
 * Attempts to sanitize and parse potentially malformed JSON from Claude API
 * @deprecated Use Claude tool calling instead of free-form JSON parsing
 * @param jsonString The raw JSON string from Claude API
 * @returns Parsed JSON object or null if parsing fails
 */
export function sanitizeAndParseJson<T = any>(jsonString: string): T | null {
  if (!jsonString || typeof jsonString !== 'string') {
    return null;
  }

  // Try parsing as-is first
  try {
    return JSON.parse(jsonString.trim()) as T;
  } catch (error) {
    // If direct parsing fails, attempt sanitization
  }

  // Common sanitization fixes for Claude API responses
  let sanitized = jsonString.trim();

  // Remove any text before the first [ or {
  const jsonStart = Math.min(
    sanitized.indexOf('[') >= 0 ? sanitized.indexOf('[') : Infinity,
    sanitized.indexOf('{') >= 0 ? sanitized.indexOf('{') : Infinity,
  );

  if (jsonStart !== Infinity && jsonStart > 0) {
    sanitized = sanitized.substring(jsonStart);
  }

  // Remove any text after the last ] or }
  const jsonEnd = Math.max(
    sanitized.lastIndexOf(']'),
    sanitized.lastIndexOf('}'),
  );

  if (jsonEnd >= 0 && jsonEnd < sanitized.length - 1) {
    sanitized = sanitized.substring(0, jsonEnd + 1);
  }

  // Fix unquoted property names (common Claude API issue)
  // Match patterns like: word: "value" and replace with "word": "value"
  sanitized = sanitized.replace(
    /([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g,
    '$1"$2":',
  );

  // Fix single quotes to double quotes
  sanitized = sanitized.replace(/'/g, '"');

  // Fix trailing commas
  sanitized = sanitized.replace(/,(\s*[}\]])/g, '$1');

  // Try parsing the sanitized version
  try {
    return JSON.parse(sanitized) as T;
  } catch (error) {
    // Final attempt: try to extract JSON array from response
    const arrayMatch = sanitized.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]) as T;
      } catch (error) {
        // If all else fails, return null
      }
    }

    return null;
  }
}

/**
 * Validates that the parsed JSON matches expected DishCategoryTopicResponse structure
 * @deprecated Use tool calling schema validation instead
 * @param data The parsed JSON data
 * @returns true if data is valid array of dish category responses
 */
export function isValidDishCategoryArray(data: any): boolean {
  if (!Array.isArray(data)) {
    return false;
  }

  return data.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.category === 'string' &&
      typeof item.topicTitle === 'string' &&
      typeof item.reason === 'string',
  );
}

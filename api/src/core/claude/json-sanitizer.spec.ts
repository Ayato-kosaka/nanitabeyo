/**
 * Tests for JSON sanitization utilities
 */

import {
  sanitizeAndParseJson,
  isValidDishCategoryArray,
} from './json-sanitizer';

describe('JSON Sanitizer', () => {
  describe('sanitizeAndParseJson', () => {
    it('should parse valid JSON correctly', () => {
      const validJson = `[
        {
          "category": "Italian",
          "topicTitle": "Pasta Night",
          "reason": "Perfect for dinner"
        }
      ]`;

      const result = sanitizeAndParseJson(validJson);
      expect(result).toEqual([
        {
          category: 'Italian',
          topicTitle: 'Pasta Night',
          reason: 'Perfect for dinner',
        },
      ]);
    });

    it('should handle unquoted property names', () => {
      const malformedJson = `[
        {
          category: "Italian",
          topicTitle: "Pasta Night", 
          reason: "Perfect for dinner"
        }
      ]`;

      const result = sanitizeAndParseJson(malformedJson);
      expect(result).toEqual([
        {
          category: 'Italian',
          topicTitle: 'Pasta Night',
          reason: 'Perfect for dinner',
        },
      ]);
    });

    it('should handle text before and after JSON', () => {
      const responseWithText = `Here is the JSON response:
      [
        {
          "category": "Italian",
          "topicTitle": "Pasta Night",
          "reason": "Perfect for dinner"
        }
      ]
      
      Hope this helps!`;

      const result = sanitizeAndParseJson(responseWithText);
      expect(result).toEqual([
        {
          category: 'Italian',
          topicTitle: 'Pasta Night',
          reason: 'Perfect for dinner',
        },
      ]);
    });

    it('should handle trailing commas', () => {
      const jsonWithTrailingCommas = `[
        {
          "category": "Italian",
          "topicTitle": "Pasta Night",
          "reason": "Perfect for dinner",
        },
      ]`;

      const result = sanitizeAndParseJson(jsonWithTrailingCommas);
      expect(result).toEqual([
        {
          category: 'Italian',
          topicTitle: 'Pasta Night',
          reason: 'Perfect for dinner',
        },
      ]);
    });

    it('should return null for invalid JSON that cannot be fixed', () => {
      const invalidJson = 'This is not JSON at all { broken }';
      const result = sanitizeAndParseJson(invalidJson);
      expect(result).toBeNull();
    });

    it('should return null for empty or null input', () => {
      expect(sanitizeAndParseJson('')).toBeNull();
      expect(sanitizeAndParseJson(null as any)).toBeNull();
      expect(sanitizeAndParseJson(undefined as any)).toBeNull();
    });
  });

  describe('isValidDishCategoryArray', () => {
    it('should validate correct dish category structure', () => {
      const validData = [
        {
          category: 'Italian',
          topicTitle: 'Pasta Night',
          reason: 'Perfect for dinner',
        },
        {
          category: 'Japanese',
          topicTitle: 'Sushi Time',
          reason: 'Fresh and healthy',
        },
      ];

      expect(isValidDishCategoryArray(validData)).toBe(true);
    });

    it('should reject non-array data', () => {
      expect(isValidDishCategoryArray({})).toBe(false);
      expect(isValidDishCategoryArray('string')).toBe(false);
      expect(isValidDishCategoryArray(null)).toBe(false);
    });

    it('should reject arrays with invalid objects', () => {
      const invalidData = [
        {
          category: 'Italian',
          // Missing topicTitle and reason
        },
      ];

      expect(isValidDishCategoryArray(invalidData)).toBe(false);
    });

    it('should reject arrays with wrong property types', () => {
      const invalidData = [
        {
          category: 123, // Should be string
          topicTitle: 'Pasta Night',
          reason: 'Perfect for dinner',
        },
      ];

      expect(isValidDishCategoryArray(invalidData)).toBe(false);
    });

    it('should handle empty arrays', () => {
      expect(isValidDishCategoryArray([])).toBe(true);
    });
  });
});

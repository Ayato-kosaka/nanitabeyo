/**
 * Tests for Claude tool calling schema validation
 */

import {
  validateDishCategoryToolResponse,
  extractDishCategoryItems,
  DishCategoryToolResponse,
  DISH_CATEGORY_TOOL_SCHEMA
} from './tool-schema';

describe('Tool Schema Validation', () => {
  describe('validateDishCategoryToolResponse', () => {
    it('should validate correct tool response with exactly 10 items', () => {
      const validResponse: DishCategoryToolResponse = {
        items: Array.from({ length: 10 }, (_, i) => ({
          category: `Category ${i + 1}`,
          topicTitle: `Title ${i + 1}`,
          reason: `Reason ${i + 1}`
        }))
      };

      expect(validateDishCategoryToolResponse(validResponse)).toBe(true);
    });

    it('should reject response with wrong number of items', () => {
      const invalidResponse = {
        items: Array.from({ length: 5 }, (_, i) => ({
          category: `Category ${i + 1}`,
          topicTitle: `Title ${i + 1}`,
          reason: `Reason ${i + 1}`
        }))
      };

      expect(validateDishCategoryToolResponse(invalidResponse)).toBe(false);
    });

    it('should reject response with missing required fields', () => {
      const invalidResponse = {
        items: Array.from({ length: 10 }, (_, i) => ({
          category: `Category ${i + 1}`,
          // Missing topicTitle and reason
        }))
      };

      expect(validateDishCategoryToolResponse(invalidResponse)).toBe(false);
    });

    it('should reject response with empty string fields', () => {
      const invalidResponse = {
        items: Array.from({ length: 10 }, (_, i) => ({
          category: '',
          topicTitle: `Title ${i + 1}`,
          reason: `Reason ${i + 1}`
        }))
      };

      expect(validateDishCategoryToolResponse(invalidResponse)).toBe(false);
    });

    it('should reject response with wrong field types', () => {
      const invalidResponse = {
        items: Array.from({ length: 10 }, (_, i) => ({
          category: 123, // Should be string
          topicTitle: `Title ${i + 1}`,
          reason: `Reason ${i + 1}`
        }))
      };

      expect(validateDishCategoryToolResponse(invalidResponse)).toBe(false);
    });

    it('should reject non-object input', () => {
      expect(validateDishCategoryToolResponse(null)).toBe(false);
      expect(validateDishCategoryToolResponse(undefined)).toBe(false);
      expect(validateDishCategoryToolResponse('string')).toBe(false);
      expect(validateDishCategoryToolResponse(123)).toBe(false);
    });

    it('should reject response without items array', () => {
      expect(validateDishCategoryToolResponse({})).toBe(false);
      expect(validateDishCategoryToolResponse({ items: null })).toBe(false);
      expect(validateDishCategoryToolResponse({ items: 'not-array' })).toBe(false);
    });
  });

  describe('extractDishCategoryItems', () => {
    it('should extract items from valid tool_use content', () => {
      const toolUseContent = {
        type: 'tool_use',
        name: 'generate_dish_categories',
        input: {
          items: Array.from({ length: 10 }, (_, i) => ({
            category: `Category ${i + 1}`,
            topicTitle: `Title ${i + 1}`,
            reason: `Reason ${i + 1}`
          }))
        }
      };

      const result = extractDishCategoryItems(toolUseContent);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(10);
      expect(result![0]).toEqual({
        category: 'Category 1',
        topicTitle: 'Title 1',
        reason: 'Reason 1'
      });
    });

    it('should return null for non-tool_use content', () => {
      const textContent = {
        type: 'text',
        text: 'Some response text'
      };

      expect(extractDishCategoryItems(textContent)).toBeNull();
    });

    it('should return null for invalid tool response structure', () => {
      const invalidToolContent = {
        type: 'tool_use',
        name: 'generate_dish_categories',
        input: {
          items: [] // Empty array, should be 10 items
        }
      };

      expect(extractDishCategoryItems(invalidToolContent)).toBeNull();
    });

    it('should return null for null/undefined input', () => {
      expect(extractDishCategoryItems(null)).toBeNull();
      expect(extractDishCategoryItems(undefined)).toBeNull();
    });
  });

  describe('DISH_CATEGORY_TOOL_SCHEMA', () => {
    it('should have correct schema structure', () => {
      expect(DISH_CATEGORY_TOOL_SCHEMA).toEqual({
        name: 'generate_dish_categories',
        description: 'Generate exactly 10 dish category recommendations with structured data',
        input_schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              minItems: 10,
              maxItems: 10,
              items: {
                type: 'object',
                properties: {
                  category: {
                    type: 'string',
                    description: 'Dish category name that matches Wikidata label exactly'
                  },
                  topicTitle: {
                    type: 'string', 
                    description: 'Catchy topic title for the recommendation'
                  },
                  reason: {
                    type: 'string',
                    description: 'Brief reason why this category is recommended'
                  }
                },
                required: ['category', 'topicTitle', 'reason'],
                additionalProperties: false
              }
            }
          },
          required: ['items'],
          additionalProperties: false
        }
      });
    });
  });
});
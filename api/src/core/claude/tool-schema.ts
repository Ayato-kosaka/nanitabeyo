/**
 * Tool calling schema definitions and validation for Claude API
 * Replaces free-form JSON parsing with structured tool responses
 */

export interface DishCategoryToolResponse {
  items: DishCategoryItem[];
}

export interface DishCategoryItem {
  category: string;
  topicTitle: string;
  reason: string;
}

/**
 * Claude tool schema for dish category recommendations
 * Enforces exactly 10 items with required string fields
 */
export const DISH_CATEGORY_TOOL_SCHEMA = {
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
};

/**
 * Validates that tool response matches expected DishCategoryToolResponse structure
 * @param data The tool response data to validate
 * @returns true if data is valid, false otherwise
 */
export function validateDishCategoryToolResponse(data: any): data is DishCategoryToolResponse {
  if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
    return false;
  }

  const { items } = data;
  
  // Must be exactly 10 items
  if (items.length !== 10) {
    return false;
  }

  // Validate each item
  return items.every((item: any) => 
    typeof item === 'object' &&
    item !== null &&
    typeof item.category === 'string' &&
    typeof item.topicTitle === 'string' &&
    typeof item.reason === 'string' &&
    item.category.trim() !== '' &&
    item.topicTitle.trim() !== '' &&
    item.reason.trim() !== ''
  );
}

/**
 * Extracts dish category items from Claude tool response
 * @param toolUseContent The tool_use content from Claude response
 * @returns Array of dish category items or null if invalid
 */
export function extractDishCategoryItems(toolUseContent: any): DishCategoryItem[] | null {
  if (!toolUseContent || toolUseContent.type !== 'tool_use') {
    return null;
  }

  const { input } = toolUseContent;
  if (!validateDishCategoryToolResponse(input)) {
    return null;
  }

  return input.items;
}
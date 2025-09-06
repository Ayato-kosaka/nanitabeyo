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
 * Language-specific text patterns for constraining tool outputs
 */
const LANGUAGE_PATTERNS: Record<string, { pattern: string; description: string }> = {
  // Japanese: exclude ASCII letters but allow other characters (hiragana, katakana, kanji, punctuation, numbers)
  'ja': {
    pattern: '^[^A-Za-z]*$',
    description: 'Text must not contain ASCII letters (A-Z, a-z)'
  },
  'ja-JP': {
    pattern: '^[^A-Za-z]*$', 
    description: 'Text must not contain ASCII letters (A-Z, a-z)'
  },
  // English: ASCII characters only
  'en': {
    pattern: '^[\x00-\x7F]*$',
    description: 'Text must contain only ASCII characters'
  },
  'en-US': {
    pattern: '^[\x00-\x7F]*$',
    description: 'Text must contain only ASCII characters'
  },
  'en-GB': {
    pattern: '^[\x00-\x7F]*$',
    description: 'Text must contain only ASCII characters'
  },
  // Chinese: exclude ASCII letters but allow other characters
  'zh': {
    pattern: '^[^A-Za-z]*$',
    description: 'Text must not contain ASCII letters (A-Z, a-z)'
  },
  'zh-CN': {
    pattern: '^[^A-Za-z]*$',
    description: 'Text must not contain ASCII letters (A-Z, a-z)'
  },
  'zh-TW': {
    pattern: '^[^A-Za-z]*$',
    description: 'Text must not contain ASCII letters (A-Z, a-z)'
  },
};

/**
 * Builds Claude tool schema for dish category recommendations with language-specific constraints
 * @param languageTag Language tag (e.g., 'ja-JP', 'en', 'zh-CN') to apply text pattern constraints
 * @returns Tool schema with language-appropriate patterns for topicTitle and reason fields
 */
export function buildDishCategoryToolSchema(languageTag: string) {
  // Extract primary language code (e.g., 'ja' from 'ja-JP')
  const primaryLanguage = languageTag.split('-')[0];
  
  // Try exact match first, then fall back to primary language
  const languagePattern = LANGUAGE_PATTERNS[languageTag] || LANGUAGE_PATTERNS[primaryLanguage];
  
  // Base properties for topicTitle and reason
  const baseTopicTitleProps = {
    type: 'string' as const,
    description: 'Catchy topic title for the recommendation',
  };
  
  const baseReasonProps = {
    type: 'string' as const,
    description: 'Brief reason why this category is recommended',
  };
  
  // Add pattern constraint if language pattern is available
  const topicTitleProps = languagePattern
    ? { ...baseTopicTitleProps, pattern: languagePattern.pattern }
    : baseTopicTitleProps;
    
  const reasonProps = languagePattern
    ? { ...baseReasonProps, pattern: languagePattern.pattern }
    : baseReasonProps;

  return {
    name: 'generate_dish_categories',
    description:
      'Generate exactly 10 dish category recommendations with structured data',
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
                description:
                  'Dish category name that matches Wikidata label exactly',
              },
              topicTitle: topicTitleProps,
              reason: reasonProps,
            },
            required: ['category', 'topicTitle', 'reason'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  };
}

/**
 * @deprecated Use buildDishCategoryToolSchema() instead for language-specific constraints
 * Default schema without language constraints (backward compatibility)
 */
export const DISH_CATEGORY_TOOL_SCHEMA = buildDishCategoryToolSchema('en');

/**
 * Validates that tool response matches expected DishCategoryToolResponse structure
 * @param data The tool response data to validate
 * @returns true if data is valid, false otherwise
 */
export function validateDishCategoryToolResponse(
  data: any,
): data is DishCategoryToolResponse {
  if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
    return false;
  }

  const { items } = data;

  // Must be exactly 10 items
  if (items.length !== 10) {
    return false;
  }

  // Validate each item
  return items.every(
    (item: any) =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.category === 'string' &&
      typeof item.topicTitle === 'string' &&
      typeof item.reason === 'string' &&
      item.category.trim() !== '' &&
      item.topicTitle.trim() !== '' &&
      item.reason.trim() !== '',
  );
}

/**
 * Extracts dish category items from Claude tool response
 * @param toolUseContent The tool_use content from Claude response
 * @returns Array of dish category items or null if invalid
 */
export function extractDishCategoryItems(
  toolUseContent: any,
): DishCategoryItem[] | null {
  if (!toolUseContent || toolUseContent.type !== 'tool_use') {
    return null;
  }

  const { input } = toolUseContent;
  if (!validateDishCategoryToolResponse(input)) {
    return null;
  }

  return input.items;
}

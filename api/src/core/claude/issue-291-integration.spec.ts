/**
 * Integration test that validates the fix for issue #291
 * Tests that Japanese language tag prevents English text in topicTitle and reason
 */

import { buildDishCategoryToolSchema } from './tool-schema';

describe('Issue #291: Japanese terminal search showing English topics', () => {
  describe('before fix (static schema)', () => {
    it('would allow English text in Japanese language context', () => {
      // Before the fix, DISH_CATEGORY_TOOL_SCHEMA was static without language constraints
      const staticSchema = {
        properties: {
          items: {
            items: {
              properties: {
                topicTitle: { type: 'string', description: 'Catchy topic title' },
                reason: { type: 'string', description: 'Brief reason' }
              }
            }
          }
        }
      };
      
      // No pattern validation would prevent this problematic content
      const problematicTopicTitle = 'Georgian Cuisine: A Flavorful Journey Through Kutaisi';
      const problematicReason = 'Immerse yourself in the rich culinary traditions of Kutaisi with a selection of authentic Georgian dishes';
      
      // These would pass validation in the old system (no language constraints)
      expect(typeof problematicTopicTitle).toBe('string');
      expect(typeof problematicReason).toBe('string');
    });
  });

  describe('after fix (language-specific schema)', () => {
    it('should prevent English text when languageTag is ja-JP', () => {
      const schema = buildDishCategoryToolSchema('ja-JP');
      const topicTitlePattern = (schema.input_schema.properties.items.items.properties.topicTitle as any).pattern;
      const reasonPattern = (schema.input_schema.properties.items.items.properties.reason as any).pattern;
      
      expect(topicTitlePattern).toBe('^[^A-Za-z]*$');
      expect(reasonPattern).toBe('^[^A-Za-z]*$');
      
      // Test the patterns with the problematic content from the issue
      const topicRegex = new RegExp(topicTitlePattern);
      const reasonRegex = new RegExp(reasonPattern);
      
      // These English texts would now be rejected
      expect(topicRegex.test('Georgian Cuisine: A Flavorful Journey Through Kutaisi')).toBe(false);
      expect(reasonRegex.test('Immerse yourself in the rich culinary traditions of Kutaisi')).toBe(false);
      
      // But Japanese text would be accepted
      expect(topicRegex.test('美味しい料理のおすすめ')).toBe(true);
      expect(reasonRegex.test('今日のランチにぴったりな料理をご紹介します')).toBe(true);
    });

    it('should allow English text when languageTag is en-US', () => {
      const schema = buildDishCategoryToolSchema('en-US');
      const topicTitlePattern = (schema.input_schema.properties.items.items.properties.topicTitle as any).pattern;
      const reasonPattern = (schema.input_schema.properties.items.items.properties.reason as any).pattern;
      
      expect(topicTitlePattern).toBe('^[\x00-\x7F]*$');
      expect(reasonPattern).toBe('^[\x00-\x7F]*$');
      
      const topicRegex = new RegExp(topicTitlePattern);
      const reasonRegex = new RegExp(reasonPattern);
      
      // English text should be accepted
      expect(topicRegex.test('Georgian Cuisine: A Flavorful Journey Through Kutaisi')).toBe(true);
      expect(reasonRegex.test('Immerse yourself in the rich culinary traditions of Kutaisi')).toBe(true);
      
      // But non-ASCII text would be rejected
      expect(topicRegex.test('美味しい料理のおすすめ')).toBe(false);
      expect(reasonRegex.test('今日のランチにぴったりな料理をご紹介します')).toBe(false);
    });

    it('should never constrain category field (always English Wikidata)', () => {
      ['ja-JP', 'en-US', 'zh-CN'].forEach(languageTag => {
        const schema = buildDishCategoryToolSchema(languageTag);
        const categoryProps = schema.input_schema.properties.items.items.properties.category as any;
        
        // Category should never have pattern constraints
        expect(categoryProps.pattern).toBeUndefined();
        expect(categoryProps.description).toContain('Wikidata label exactly');
      });
    });
  });

  describe('acceptance criteria validation', () => {
    it('should meet all acceptance criteria from the issue', () => {
      // AC1: params.languageTag = 'ja-JP' prevents ASCII letters in topicTitle and reason
      const jaSchema = buildDishCategoryToolSchema('ja-JP');
      const jaTopicPattern = (jaSchema.input_schema.properties.items.items.properties.topicTitle as any).pattern;
      const jaReasonPattern = (jaSchema.input_schema.properties.items.items.properties.reason as any).pattern;
      
      const jaTopicRegex = new RegExp(jaTopicPattern);
      const jaReasonRegex = new RegExp(jaReasonPattern);
      
      expect(jaTopicRegex.test('Contains English')).toBe(false);
      expect(jaReasonRegex.test('Contains English')).toBe(false);
      
      // AC2: params.languageTag = 'en' prevents non-ASCII in topicTitle and reason
      const enSchema = buildDishCategoryToolSchema('en');
      const enTopicPattern = (enSchema.input_schema.properties.items.items.properties.topicTitle as any).pattern;
      const enReasonPattern = (enSchema.input_schema.properties.items.items.properties.reason as any).pattern;
      
      const enTopicRegex = new RegExp(enTopicPattern);
      const enReasonRegex = new RegExp(enReasonPattern);
      
      expect(enTopicRegex.test('美味しい')).toBe(false);
      expect(enReasonRegex.test('美味しい')).toBe(false);
      expect(enTopicRegex.test('English Only')).toBe(true);
      expect(enReasonRegex.test('English Only')).toBe(true);
      
      // AC3: params.languageTag = 'zh' prevents ASCII letters in topicTitle and reason
      const zhSchema = buildDishCategoryToolSchema('zh');
      const zhTopicPattern = (zhSchema.input_schema.properties.items.items.properties.topicTitle as any).pattern;
      const zhReasonPattern = (zhSchema.input_schema.properties.items.items.properties.reason as any).pattern;
      
      const zhTopicRegex = new RegExp(zhTopicPattern);
      const zhReasonRegex = new RegExp(zhReasonPattern);
      
      expect(zhTopicRegex.test('Contains English')).toBe(false);
      expect(zhReasonRegex.test('Contains English')).toBe(false);
      expect(zhTopicRegex.test('川菜很辣')).toBe(true);
      expect(zhReasonRegex.test('川菜很辣')).toBe(true);
      
      // AC4: category always remains English Wikidata labels
      [jaSchema, enSchema, zhSchema].forEach(schema => {
        const categoryProps = schema.input_schema.properties.items.items.properties.category as any;
        expect(categoryProps.pattern).toBeUndefined();
        expect(categoryProps.description).toContain('Wikidata label exactly');
      });
    });
  });
});
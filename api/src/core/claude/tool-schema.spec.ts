/**
 * Test suite for language-specific tool schema generation
 */

import { buildDishCategoryToolSchema, DISH_CATEGORY_TOOL_SCHEMA } from './tool-schema';

describe('buildDishCategoryToolSchema', () => {
  describe('language pattern constraints', () => {
    it('should apply Japanese pattern for ja-JP language tag', () => {
      const schema = buildDishCategoryToolSchema('ja-JP');
      
      const topicTitleProps = schema.input_schema.properties.items.items.properties.topicTitle as any;
      const reasonProps = schema.input_schema.properties.items.items.properties.reason as any;
      
      expect(topicTitleProps.pattern).toBe('^[^A-Za-z]*$');
      expect(reasonProps.pattern).toBe('^[^A-Za-z]*$');
    });

    it('should apply Japanese pattern for ja language tag', () => {
      const schema = buildDishCategoryToolSchema('ja');
      
      const topicTitleProps = schema.input_schema.properties.items.items.properties.topicTitle as any;
      const reasonProps = schema.input_schema.properties.items.items.properties.reason as any;
      
      expect(topicTitleProps.pattern).toBe('^[^A-Za-z]*$');
      expect(reasonProps.pattern).toBe('^[^A-Za-z]*$');
    });

    it('should apply ASCII pattern for en language tag', () => {
      const schema = buildDishCategoryToolSchema('en');
      
      const topicTitleProps = schema.input_schema.properties.items.items.properties.topicTitle as any;
      const reasonProps = schema.input_schema.properties.items.items.properties.reason as any;
      
      expect(topicTitleProps.pattern).toBe('^[\x00-\x7F]*$');
      expect(reasonProps.pattern).toBe('^[\x00-\x7F]*$');
    });

    it('should apply ASCII pattern for en-US language tag', () => {
      const schema = buildDishCategoryToolSchema('en-US');
      
      const topicTitleProps = schema.input_schema.properties.items.items.properties.topicTitle as any;
      const reasonProps = schema.input_schema.properties.items.items.properties.reason as any;
      
      expect(topicTitleProps.pattern).toBe('^[\x00-\x7F]*$');
      expect(reasonProps.pattern).toBe('^[\x00-\x7F]*$');
    });

    it('should apply Chinese pattern for zh-CN language tag', () => {
      const schema = buildDishCategoryToolSchema('zh-CN');
      
      const topicTitleProps = schema.input_schema.properties.items.items.properties.topicTitle as any;
      const reasonProps = schema.input_schema.properties.items.items.properties.reason as any;
      
      expect(topicTitleProps.pattern).toBe('^[^A-Za-z]*$');
      expect(reasonProps.pattern).toBe('^[^A-Za-z]*$');
    });

    it('should fall back to primary language for complex language tags', () => {
      const schema = buildDishCategoryToolSchema('ja-JP-Hira');
      
      const topicTitleProps = schema.input_schema.properties.items.items.properties.topicTitle as any;
      const reasonProps = schema.input_schema.properties.items.items.properties.reason as any;
      
      // Should use 'ja' pattern since 'ja-JP-Hira' doesn't exist
      expect(topicTitleProps.pattern).toBe('^[^A-Za-z]*$');
      expect(reasonProps.pattern).toBe('^[^A-Za-z]*$');
    });

    it('should not apply pattern for unsupported language tags', () => {
      const schema = buildDishCategoryToolSchema('xyz-UNKNOWN');
      
      const topicTitleProps = schema.input_schema.properties.items.items.properties.topicTitle as any;
      const reasonProps = schema.input_schema.properties.items.items.properties.reason as any;
      
      expect(topicTitleProps.pattern).toBeUndefined();
      expect(reasonProps.pattern).toBeUndefined();
    });
  });

  describe('schema structure', () => {
    it('should maintain base schema structure regardless of language', () => {
      const schema = buildDishCategoryToolSchema('ja-JP');
      
      expect(schema.name).toBe('generate_dish_categories');
      expect(schema.description).toContain('exactly 10 dish category recommendations');
      expect(schema.input_schema.properties.items.minItems).toBe(10);
      expect(schema.input_schema.properties.items.maxItems).toBe(10);
      expect(schema.input_schema.required).toEqual(['items']);
    });

    it('should never apply pattern to category field', () => {
      const jaSchema = buildDishCategoryToolSchema('ja-JP');
      const enSchema = buildDishCategoryToolSchema('en');
      
      const jaCategoryProps = jaSchema.input_schema.properties.items.items.properties.category as any;
      const enCategoryProps = enSchema.input_schema.properties.items.items.properties.category as any;
      
      expect(jaCategoryProps.pattern).toBeUndefined();
      expect(enCategoryProps.pattern).toBeUndefined();
      expect(jaCategoryProps.description).toContain('Wikidata label exactly');
      expect(enCategoryProps.description).toContain('Wikidata label exactly');
    });

    it('should preserve required fields', () => {
      const schema = buildDishCategoryToolSchema('ja-JP');
      
      const itemRequired = schema.input_schema.properties.items.items.required;
      expect(itemRequired).toEqual(['category', 'topicTitle', 'reason']);
    });
  });

  describe('backward compatibility', () => {
    it('should maintain DISH_CATEGORY_TOOL_SCHEMA as English schema', () => {
      const enSchema = buildDishCategoryToolSchema('en');
      
      expect(DISH_CATEGORY_TOOL_SCHEMA).toEqual(enSchema);
    });
  });
});
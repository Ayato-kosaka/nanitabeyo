/**
 * Integration tests for language pattern validation
 */

describe('Language Pattern Validation', () => {
  describe('Japanese pattern ^[^A-Za-z]*$', () => {
    const pattern = /^[^A-Za-z]*$/;

    it('should accept Japanese text', () => {
      expect(pattern.test('美味しい料理のおすすめ')).toBe(true);
      expect(pattern.test('今日のランチは何にしよう？')).toBe(true);
      expect(pattern.test('カレーライス')).toBe(true);
      expect(pattern.test('123番の定食')).toBe(true);
    });

    it('should reject English letters', () => {
      expect(pattern.test('Georgian Cuisine: A Flavorful Journey')).toBe(false);
      expect(pattern.test('Hello World')).toBe(false);
      expect(pattern.test('美味しいCurry')).toBe(false);
      expect(pattern.test('Sushi')).toBe(false);
    });

    it('should accept numbers and symbols', () => {
      expect(pattern.test('123')).toBe(true);
      expect(pattern.test('!@#$%^&*()')).toBe(true);
      expect(pattern.test('１２３４５')).toBe(true);
      expect(pattern.test('「」、。・')).toBe(true);
    });
  });

  describe('English pattern ^[\\x00-\\x7F]*$', () => {
    const pattern = /^[\x00-\x7F]*$/;

    it('should accept ASCII text', () => {
      expect(pattern.test('Georgian Cuisine: A Flavorful Journey')).toBe(true);
      expect(pattern.test('Hello World')).toBe(true);
      expect(pattern.test('123 Main Street')).toBe(true);
      expect(pattern.test('Spicy and delicious!')).toBe(true);
    });

    it('should reject non-ASCII characters', () => {
      expect(pattern.test('美味しい料理')).toBe(false);
      expect(pattern.test('Café')).toBe(false);
      expect(pattern.test('Naïve')).toBe(false);
      expect(pattern.test('Piñata')).toBe(false);
    });

    it('should accept ASCII symbols and numbers', () => {
      expect(pattern.test('123')).toBe(true);
      expect(pattern.test('!@#$%^&*()')).toBe(true);
      expect(pattern.test('Hello, world!')).toBe(true);
    });
  });

  describe('Chinese pattern ^[^A-Za-z]*$', () => {
    const pattern = /^[^A-Za-z]*$/;

    it('should accept Chinese text', () => {
      expect(pattern.test('美味的中國菜')).toBe(true);
      expect(pattern.test('今天吃什麼？')).toBe(true);
      expect(pattern.test('川菜很辣')).toBe(true);
      expect(pattern.test('123号菜')).toBe(true);
    });

    it('should reject English letters', () => {
      expect(pattern.test('Chinese Food')).toBe(false);
      expect(pattern.test('美味的food')).toBe(false);
      expect(pattern.test('Hot pot')).toBe(false);
    });

    it('should accept numbers and symbols', () => {
      expect(pattern.test('123')).toBe(true);
      expect(pattern.test('！@#￥%……&*（）')).toBe(true);
      expect(pattern.test('「」，。、')).toBe(true);
    });
  });
});
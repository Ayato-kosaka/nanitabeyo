// api/src/core/utils/backend-utils.spec.ts

import { roundToOneDecimal } from './backend-utils';

describe('backend-utils', () => {
  describe('roundToOneDecimal', () => {
    it('should round 3.333 to 3.3', () => {
      expect(roundToOneDecimal(3.333)).toBe(3.3);
    });

    it('should round 4.66 to 4.7', () => {
      expect(roundToOneDecimal(4.66)).toBe(4.7);
    });

    it('should keep 4.0 as 4.0', () => {
      expect(roundToOneDecimal(4.0)).toBe(4.0);
    });

    it('should round 3.34 to 3.3', () => {
      expect(roundToOneDecimal(3.34)).toBe(3.3);
    });

    it('should round 3.35 to 3.4', () => {
      expect(roundToOneDecimal(3.35)).toBe(3.4);
    });

    it('should handle 0 correctly', () => {
      expect(roundToOneDecimal(0)).toBe(0);
    });

    it('should handle negative numbers correctly', () => {
      expect(roundToOneDecimal(-3.34)).toBe(-3.3);
      expect(roundToOneDecimal(-3.36)).toBe(-3.4);
    });

    it('should handle very small numbers', () => {
      expect(roundToOneDecimal(0.04)).toBe(0);
      expect(roundToOneDecimal(0.05)).toBe(0.1);
    });

    it('should handle large numbers', () => {
      expect(roundToOneDecimal(999.95)).toBe(1000.0);
      expect(roundToOneDecimal(123.456)).toBe(123.5);
    });
  });
});

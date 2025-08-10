/**
 * Currency formatting utilities using proper internationalization.
 * 
 * This module provides locale-aware currency formatting that replaces
 * the incorrect manual suffix/prefix concatenation pattern.
 */

export interface CurrencyConfig {
  currency: string;
  locale: string;
}

/**
 * Map of locale to currency configuration.
 * This determines which currency to use for each locale.
 */
const LOCALE_CURRENCY_MAP: Record<string, string> = {
  'ja-JP': 'JPY',
  'ja': 'JPY',
  'en-US': 'JPY', // Using JPY as this appears to be a Japanese food app
  'en-GB': 'JPY',
  'en': 'JPY',
  'ko-KR': 'JPY', // Korean users still see JPY prices
  'ko': 'JPY',
  'zh-CN': 'JPY', // Chinese users still see JPY prices
  'zh-Hans': 'JPY',
  'zh': 'JPY',
  'fr-FR': 'JPY',
  'fr': 'JPY',
  'es-ES': 'JPY',
  'es': 'JPY',
  'ar-SA': 'JPY',
  'ar': 'JPY',
  'hi-IN': 'JPY',
  'hi': 'JPY'
};

/**
 * Format currency amount using proper locale-aware formatting.
 * 
 * This function uses the native Intl.NumberFormat API to ensure
 * correct currency symbol placement, spacing, and number formatting
 * according to locale conventions.
 * 
 * @param amount - The numeric amount to format
 * @param locale - The locale string (e.g., 'ja-JP', 'en-US')
 * @returns Properly formatted currency string
 * 
 * @example
 * formatCurrency(1000, 'ja-JP') // "¥1,000"
 * formatCurrency(1000, 'en-US') // "¥1,000"
 * formatCurrency(2800, 'ja-JP') // "¥2,800"
 */
export function formatCurrency(amount: number, locale: string): string {
  const currency = LOCALE_CURRENCY_MAP[locale] || 'JPY';
  
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch (error) {
    // Fallback to basic formatting if locale is not supported
    console.warn(`Unsupported locale: ${locale}, falling back to ja-JP`);
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: 'JPY',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }
}

/**
 * Format currency amount for display in components.
 * This is a convenience wrapper that uses the current locale from i18n.
 * 
 * @param amount - The numeric amount to format
 * @param currentLocale - The current locale from the i18n system
 * @returns Properly formatted currency string
 */
export function formatCurrencyForDisplay(amount: number, currentLocale: string): string {
  return formatCurrency(amount, currentLocale);
}

/**
 * Legacy support: Get currency symbol for a locale.
 * This function provides the currency symbol only, for cases where
 * only the symbol is needed (should be rare).
 * 
 * @param locale - The locale string
 * @returns Currency symbol (e.g., '¥')
 */
export function getCurrencySymbol(locale: string): string {
  const currency = LOCALE_CURRENCY_MAP[locale] || 'JPY';
  
  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    
    // Extract just the currency symbol
    const parts = formatter.formatToParts(0);
    const currencyPart = parts.find(part => part.type === 'currency');
    return currencyPart?.value || '¥';
  } catch (error) {
    return '¥'; // Default fallback
  }
}
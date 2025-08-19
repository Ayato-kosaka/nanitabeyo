/**
 * Configuration for dish-categories/recommendations functional testing
 *
 * Defines parameter sets and sampling strategies for comprehensive API testing
 */

import type { QueryDishCategoryRecommendationsDto } from '@shared/v1/dto';

// Test parameter sets based on frontend implementation
export const TEST_PARAMETERS = {
  // Sample addresses for location context (Japanese addresses with English equivalents)
  addresses: [
    'Shibuya, Tokyo, Japan',
    'Kyoto Station, Kyoto, Japan',
    'Kraljevice, Bosnia & Herzegovina',
  ],

  // Time slots from frontend constants
  timeSlots: ['morning', 'lunch', 'dinner', 'late_night'],

  // Scene options from frontend constants
  scenes: ['solo', 'date', 'group', 'large_group', 'tourism'],

  // Mood options from frontend constants
  moods: ['hearty', 'light', 'sweet', 'spicy', 'healthy', 'junk', 'alcohol'],

  // Dietary restrictions from frontend constants
  restrictions: [
    ['vegetarian'],
    ['gluten_free'],
    ['dairy_free'],
    ['nut_allergy'],
    ['seafood_allergy'],
    ['halal'],
    ['vegetarian', 'gluten_free'], // Multiple restrictions
    ['dairy_free', 'nut_allergy'],
    [], // No restrictions
  ] as string[][],

  // Language tags from i18n supported locales (primary ones)
  languageTags: ['en-US', 'ja-JP'],
} as const;

// Sampling strategy types
export type SamplingStrategy = 'cartesian' | 'random' | 'stratified';

// Configuration interface
export interface TestConfig {
  // API endpoint configuration
  baseUrl: string;
  endpoint: string;

  // Sampling configuration
  strategy: SamplingStrategy;
  maxRequests: number;

  // Rate limiting configuration
  requestsPerMinute: number;
  maxConcurrent: number;

  // Retry configuration
  maxRetries: number;
  retryDelayBase: number; // Base delay in ms for exponential backoff
  retryJitter: boolean;

  // Output configuration
  csvOutputPath: string;
  logOutputPath: string;
  includeFullResponse: boolean;
}

// Default configuration
export const DEFAULT_CONFIG: TestConfig = {
  baseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
  endpoint: '/v1/dish-categories/recommendations',

  strategy:
    (process.env.RECO_SAMPLING_STRATEGY as SamplingStrategy) || 'stratified',
  maxRequests: parseInt(process.env.RECO_MAX_REQUESTS || '100'),

  requestsPerMinute: parseInt(process.env.REQUESTS_PER_MINUTE || '30'),
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT || '3'),

  maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
  retryDelayBase: parseInt(process.env.RETRY_DELAY_BASE || '1000'),
  retryJitter: process.env.RETRY_JITTER !== 'false',

  csvOutputPath:
    process.env.CSV_OUTPUT_PATH ||
    './test-results/dish-categories-recommendations.csv',
  logOutputPath:
    process.env.LOG_OUTPUT_PATH ||
    './test-results/dish-categories-recommendations.log',
  includeFullResponse: process.env.INCLUDE_FULL_RESPONSE === 'true',
};

/**
 * Generate test parameter combinations based on strategy
 */
export function generateParameterCombinations(
  config: TestConfig,
): QueryDishCategoryRecommendationsDto[] {
  const { strategy, maxRequests } = config;

  switch (strategy) {
    case 'cartesian':
      return generateCartesianCombinations(maxRequests);
    case 'random':
      return generateRandomCombinations(maxRequests);
    case 'stratified':
      return generateStratifiedCombinations(maxRequests);
    default:
      throw new Error(`Unknown sampling strategy: ${strategy}`);
  }
}

/**
 * Generate all possible combinations (cartesian product)
 */
function generateCartesianCombinations(
  maxRequests: number,
): QueryDishCategoryRecommendationsDto[] {
  const combinations: QueryDishCategoryRecommendationsDto[] = [];

  for (const address of TEST_PARAMETERS.addresses) {
    for (const languageTag of TEST_PARAMETERS.languageTags) {
      // Required parameters combination
      const baseParams = { address, languageTag };

      // Add combinations with optional parameters
      for (const timeSlot of [undefined, ...TEST_PARAMETERS.timeSlots]) {
        for (const scene of [undefined, ...TEST_PARAMETERS.scenes]) {
          for (const mood of [undefined, ...TEST_PARAMETERS.moods]) {
            for (const restrictions of TEST_PARAMETERS.restrictions) {
              const params: QueryDishCategoryRecommendationsDto = {
                ...baseParams,
                ...(timeSlot && { timeSlot }),
                ...(scene && { scene }),
                ...(mood && { mood }),
                ...(restrictions.length > 0 && {
                  restrictions: [...restrictions],
                }),
              };

              combinations.push(params);

              if (combinations.length >= maxRequests) {
                return combinations;
              }
            }
          }
        }
      }
    }
  }

  return combinations;
}

/**
 * Generate random combinations
 */
function generateRandomCombinations(
  maxRequests: number,
): QueryDishCategoryRecommendationsDto[] {
  const combinations: QueryDishCategoryRecommendationsDto[] = [];

  for (let i = 0; i < maxRequests; i++) {
    const params: QueryDishCategoryRecommendationsDto = {
      address: getRandomElement(TEST_PARAMETERS.addresses),
      languageTag: getRandomElement(TEST_PARAMETERS.languageTags),
    };

    // Randomly include optional parameters (50% chance each)
    if (Math.random() > 0.5) {
      params.timeSlot = getRandomElement(TEST_PARAMETERS.timeSlots);
    }
    if (Math.random() > 0.5) {
      params.scene = getRandomElement(TEST_PARAMETERS.scenes);
    }
    if (Math.random() > 0.5) {
      params.mood = getRandomElement(TEST_PARAMETERS.moods);
    }
    if (Math.random() > 0.5) {
      const restrictionsArray = getRandomElement(TEST_PARAMETERS.restrictions);
      if (restrictionsArray.length > 0) {
        params.restrictions = [...restrictionsArray];
      }
    }

    combinations.push(params);
  }

  return combinations;
}

/**
 * Generate stratified combinations (even distribution across parameters)
 */
function generateStratifiedCombinations(
  maxRequests: number,
): QueryDishCategoryRecommendationsDto[] {
  const combinations: QueryDishCategoryRecommendationsDto[] = [];

  // Calculate how many samples per stratum
  const addressCount = TEST_PARAMETERS.addresses.length;
  const languageCount = TEST_PARAMETERS.languageTags.length;
  const samplesPerStratum = Math.ceil(
    maxRequests / (addressCount * languageCount),
  );

  for (const address of TEST_PARAMETERS.addresses) {
    for (const languageTag of TEST_PARAMETERS.languageTags) {
      for (
        let i = 0;
        i < samplesPerStratum && combinations.length < maxRequests;
        i++
      ) {
        const params: QueryDishCategoryRecommendationsDto = {
          address,
          languageTag,
        };

        // Systematically vary optional parameters
        const variation = i % 16; // 2^4 variations for 4 optional parameter types

        if (variation & 1) {
          params.timeSlot =
            TEST_PARAMETERS.timeSlots[i % TEST_PARAMETERS.timeSlots.length];
        }
        if (variation & 2) {
          params.scene =
            TEST_PARAMETERS.scenes[i % TEST_PARAMETERS.scenes.length];
        }
        if (variation & 4) {
          params.mood = TEST_PARAMETERS.moods[i % TEST_PARAMETERS.moods.length];
        }
        if (variation & 8) {
          const restrictionsArray =
            TEST_PARAMETERS.restrictions[
              i % TEST_PARAMETERS.restrictions.length
            ];
          if (restrictionsArray.length > 0) {
            params.restrictions = [...restrictionsArray];
          }
        }

        combinations.push(params);
      }
    }
  }

  return combinations.slice(0, maxRequests);
}

/**
 * Get random element from array
 */
function getRandomElement<T>(array: readonly T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Validate configuration
 */
export function validateConfig(config: TestConfig): void {
  if (config.maxRequests <= 0) {
    throw new Error('maxRequests must be positive');
  }
  if (config.requestsPerMinute <= 0) {
    throw new Error('requestsPerMinute must be positive');
  }
  if (config.maxConcurrent <= 0) {
    throw new Error('maxConcurrent must be positive');
  }
  if (config.maxRetries < 0) {
    throw new Error('maxRetries must be non-negative');
  }
  if (!config.baseUrl) {
    throw new Error('baseUrl is required');
  }
}

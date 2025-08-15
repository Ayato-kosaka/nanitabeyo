/**
 * Configuration for dish-categories/recommendations functional testing
 * Supports environment variables and CLI arguments for cost control
 */
/**
 * Default parameter values for testing
 */
export const DEFAULT_PARAMETER_SAMPLES = {
    addresses: [
        '東京都渋谷区',
        '大阪府大阪市',
        '愛知県名古屋市',
        '神奈川県横浜市',
        '福岡県福岡市',
        'Tokyo, Japan',
        'New York, NY, USA',
        'London, UK',
        'Paris, France',
        'Seoul, South Korea'
    ],
    timeSlots: [
        '朝',
        '昼',
        '夜',
        '深夜',
        'morning',
        'lunch',
        'dinner',
        'late night'
    ],
    scenes: [
        'デート',
        '家族',
        '友人',
        'ビジネス',
        '一人',
        'date',
        'family',
        'friends',
        'business',
        'solo'
    ],
    moods: [
        'さっぱり',
        'がっつり',
        'あっさり',
        'こってり',
        'ヘルシー',
        'light',
        'hearty',
        'fresh',
        'rich',
        'healthy'
    ],
    restrictions: [
        [],
        ['vegetarian'],
        ['vegan'],
        ['gluten-free'],
        ['halal'],
        ['kosher'],
        ['低糖質'],
        ['低カロリー'],
        ['ベジタリアン'],
        ['ヴィーガン']
    ],
    languageTags: [
        'ja-JP',
        'en-US',
        'ko-KR',
        'zh-CN',
        'fr-FR',
        'es-ES',
        'ar-SA',
        'hi-IN'
    ]
};
/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
    strategy: 'stratified',
    maxRequests: parseInt(process.env.RECO_MAX_REQUESTS || '100'),
    requestsPerMinute: parseInt(process.env.REQUESTS_PER_MINUTE || '30'),
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT || '3'),
    timeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '30000'),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
    retryBackoffBaseMs: parseInt(process.env.RETRY_BACKOFF_BASE_MS || '1000'),
    retryBackoffMaxMs: parseInt(process.env.RETRY_BACKOFF_MAX_MS || '10000'),
    apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
    outputDir: process.env.OUTPUT_DIR || './test-output',
    csvFilename: process.env.CSV_FILENAME || 'reco-results.csv',
    logFilename: process.env.LOG_FILENAME || 'reco-run.log'
};
/**
 * Generate parameter combinations based on strategy
 */
export function generateParameterCombinations(samples, strategy, maxRequests) {
    switch (strategy) {
        case 'cartesian':
            return generateCartesianCombinations(samples, maxRequests);
        case 'random':
            return generateRandomCombinations(samples, maxRequests);
        case 'stratified':
            return generateStratifiedCombinations(samples, maxRequests);
        default:
            throw new Error(`Unknown strategy: ${strategy}`);
    }
}
/**
 * Generate all possible combinations (cartesian product)
 */
function generateCartesianCombinations(samples, maxRequests) {
    const combinations = [];
    for (const address of samples.addresses) {
        for (const languageTag of samples.languageTags) {
            // Required parameters only
            const baseCombo = { address, languageTag };
            combinations.push(baseCombo);
            if (combinations.length >= maxRequests) {
                return combinations.slice(0, maxRequests);
            }
            // Add optional parameters
            for (const timeSlot of [...samples.timeSlots, undefined]) {
                for (const scene of [...samples.scenes, undefined]) {
                    for (const mood of [...samples.moods, undefined]) {
                        for (const restrictions of [...samples.restrictions, undefined]) {
                            const combo = {
                                address,
                                languageTag,
                                ...(timeSlot && { timeSlot }),
                                ...(scene && { scene }),
                                ...(mood && { mood }),
                                ...(restrictions && { restrictions })
                            };
                            combinations.push(combo);
                            if (combinations.length >= maxRequests) {
                                return combinations.slice(0, maxRequests);
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
function generateRandomCombinations(samples, maxRequests) {
    const combinations = [];
    for (let i = 0; i < maxRequests; i++) {
        const combo = {
            address: getRandomElement(samples.addresses),
            languageTag: getRandomElement(samples.languageTags)
        };
        // Randomly include optional parameters (50% chance each)
        if (Math.random() > 0.5) {
            combo.timeSlot = getRandomElement(samples.timeSlots);
        }
        if (Math.random() > 0.5) {
            combo.scene = getRandomElement(samples.scenes);
        }
        if (Math.random() > 0.5) {
            combo.mood = getRandomElement(samples.moods);
        }
        if (Math.random() > 0.5) {
            combo.restrictions = getRandomElement(samples.restrictions);
        }
        combinations.push(combo);
    }
    return combinations;
}
/**
 * Generate stratified combinations (balanced sampling)
 */
function generateStratifiedCombinations(samples, maxRequests) {
    const combinations = [];
    // Calculate strata sizes
    const addressStrata = Math.min(samples.addresses.length, Math.ceil(Math.sqrt(maxRequests)));
    const languageStrata = Math.min(samples.languageTags.length, Math.ceil(maxRequests / addressStrata));
    for (let i = 0; i < maxRequests; i++) {
        const addressIndex = i % samples.addresses.length;
        const languageIndex = Math.floor(i / samples.addresses.length) % samples.languageTags.length;
        const combo = {
            address: samples.addresses[addressIndex],
            languageTag: samples.languageTags[languageIndex]
        };
        // Add optional parameters in a rotating fashion
        const optionalIndex = i % 16; // 2^4 combinations for optional params
        if (optionalIndex & 1) {
            combo.timeSlot = samples.timeSlots[i % samples.timeSlots.length];
        }
        if (optionalIndex & 2) {
            combo.scene = samples.scenes[i % samples.scenes.length];
        }
        if (optionalIndex & 4) {
            combo.mood = samples.moods[i % samples.moods.length];
        }
        if (optionalIndex & 8) {
            combo.restrictions = samples.restrictions[i % samples.restrictions.length];
        }
        combinations.push(combo);
    }
    return combinations;
}
/**
 * Utility function to get a random element from an array
 */
function getRandomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
}
/**
 * Parse CLI arguments and merge with environment config
 */
export function parseConfig(args = []) {
    const config = { ...DEFAULT_CONFIG };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        switch (arg) {
            case '--strategy':
                if (nextArg && ['cartesian', 'random', 'stratified'].includes(nextArg)) {
                    config.strategy = nextArg;
                    i++;
                }
                break;
            case '--max-requests':
                if (nextArg && !isNaN(parseInt(nextArg))) {
                    config.maxRequests = parseInt(nextArg);
                    i++;
                }
                break;
            case '--rpm':
                if (nextArg && !isNaN(parseInt(nextArg))) {
                    config.requestsPerMinute = parseInt(nextArg);
                    i++;
                }
                break;
            case '--concurrent':
                if (nextArg && !isNaN(parseInt(nextArg))) {
                    config.maxConcurrent = parseInt(nextArg);
                    i++;
                }
                break;
            case '--api-url':
                if (nextArg) {
                    config.apiBaseUrl = nextArg;
                    i++;
                }
                break;
            case '--output-dir':
                if (nextArg) {
                    config.outputDir = nextArg;
                    i++;
                }
                break;
        }
    }
    return config;
}

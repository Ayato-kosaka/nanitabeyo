/**
 * Functional test runner for dish-categories/recommendations API
 *
 * Executes comprehensive parameter testing with rate limiting, retries, and CSV output
 */

import { randomBytes } from 'crypto';
import type { QueryDishCategoryRecommendationsDto } from '@shared/v1/dto';
import type {
  BaseResponse,
  QueryDishCategoryRecommendationsResponse,
} from '@shared/v1/res';
import {
  TestConfig,
  DEFAULT_CONFIG,
  generateParameterCombinations,
  validateConfig,
} from './config';
import {
  CsvWriter,
  createTestResults,
  generateSummary,
  writeSummaryLog,
  type TestResult,
} from './csv';

/**
 * Token bucket for rate limiting
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per millisecond

  constructor(capacity: number, refillPerMinute: number) {
    this.capacity = capacity;
    this.refillRate = refillPerMinute / (60 * 1000); // Convert to per-millisecond
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume a token
   */
  consume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return true;
    }
    return false;
  }

  /**
   * Get time to wait for next token (ms)
   */
  getWaitTime(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.refillRate);
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

/**
 * HTTP response interface
 */
interface ApiResponse {
  success: boolean;
  statusCode?: number;
  data?: QueryDishCategoryRecommendationsResponse;
  error?: string;
}

/**
 * Semaphore for controlling concurrent requests
 */
class Semaphore {
  private permits: number;
  private readonly maxPermits: number;
  private readonly waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
    this.maxPermits = permits;
  }

  /**
   * Acquire a permit
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  /**
   * Release a permit
   */
  release(): void {
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      resolve();
    } else {
      this.permits = Math.min(this.maxPermits, this.permits + 1);
    }
  }
}

/**
 * Main test runner class
 */
export class DishCategoriesTestRunner {
  private config: TestConfig;
  private tokenBucket: TokenBucket;
  private semaphore: Semaphore;
  private csvWriter: CsvWriter;
  private results: TestResult[] = [];

  constructor(config: Partial<TestConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    validateConfig(this.config);

    this.tokenBucket = new TokenBucket(
      this.config.maxConcurrent * 2, // Allow some burst capacity
      this.config.requestsPerMinute,
    );
    this.semaphore = new Semaphore(this.config.maxConcurrent);
    this.csvWriter = new CsvWriter(this.config.csvOutputPath);
  }

  /**
   * Run the functional test suite
   */
  async run(): Promise<void> {
    console.log('🚀 Starting dish-categories/recommendations functional test');
    console.log(`📊 Configuration:`);
    console.log(`   Strategy: ${this.config.strategy}`);
    console.log(`   Max Requests: ${this.config.maxRequests}`);
    console.log(`   Rate Limit: ${this.config.requestsPerMinute}/min`);
    console.log(`   Concurrency: ${this.config.maxConcurrent}`);
    console.log(`   Base URL: ${this.config.baseUrl}`);
    console.log(`   Output: ${this.config.csvOutputPath}`);
    console.log('');

    try {
      // Initialize CSV writer
      await this.csvWriter.initialize();

      // Generate parameter combinations
      const combinations = generateParameterCombinations(this.config);
      console.log(`📝 Generated ${combinations.length} parameter combinations`);

      // Execute tests with progress tracking
      const startTime = Date.now();
      await this.executeTests(combinations);
      const endTime = Date.now();

      // Generate and write summary
      const summary = generateSummary(this.results);
      await writeSummaryLog(summary, this.config.logOutputPath);

      console.log('\n✅ Test execution completed');
      console.log(
        `⏱️  Total time: ${((endTime - startTime) / 1000).toFixed(2)}s`,
      );
      console.log(
        `📈 Success rate: ${(summary.successRate * 100).toFixed(2)}%`,
      );
      console.log(`📁 Results saved to: ${this.config.csvOutputPath}`);
      console.log(`📄 Summary saved to: ${this.config.logOutputPath}`);
    } catch (error) {
      console.error('❌ Test execution failed:', error);
      throw error;
    } finally {
      await this.csvWriter.close();
    }
  }

  /**
   * Execute all test combinations
   */
  private async executeTests(
    combinations: QueryDishCategoryRecommendationsDto[],
  ): Promise<void> {
    const promises: Array<Promise<void>> = [];

    for (let i = 0; i < combinations.length; i++) {
      const combination = combinations[i];
      const requestId = this.generateRequestId();
      const requestIndex = i + 1; // 1-based index

      // Create promise for this request
      const promise = this.executeTestWithRateLimit(
        requestIndex,
        requestId,
        combination,
        i + 1,
        combinations.length,
      );
      promises.push(promise);
    }

    // Wait for all requests to complete
    await Promise.all(promises);
  }

  /**
   * Execute single test with rate limiting
   */
  private async executeTestWithRateLimit(
    requestIndex: number,
    requestId: string,
    params: QueryDishCategoryRecommendationsDto,
    index: number,
    total: number,
  ): Promise<void> {
    // Wait for rate limit token
    while (!this.tokenBucket.consume()) {
      const waitTime = this.tokenBucket.getWaitTime();
      await this.delay(waitTime);
    }

    // Acquire concurrency permit
    await this.semaphore.acquire();

    try {
      await this.executeTest(requestIndex, requestId, params, index, total);
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * Execute single test with retry logic
   */
  private async executeTest(
    requestIndex: number,
    requestId: string,
    params: QueryDishCategoryRecommendationsDto,
    index: number,
    total: number,
  ): Promise<void> {
    const startTime = Date.now();
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.makeApiRequest(params);
        const duration = Date.now() - startTime;

        // Create and store results (one per category)
        const results = createTestResults(requestId, params, {
          ...response,
          duration,
        });

        this.results.push(...results);

        // Write all results to CSV
        for (const result of results) {
          await this.csvWriter.writeResult(result);
        }

        // Log progress
        const status = response.success ? '✅' : '❌';
        const progressPercent = ((index / total) * 100).toFixed(1);
        const categoryCount = response.data?.length || 0;
        console.log(
          `${status} [${progressPercent}%] ${index}/${total} - ${params.address} (${params.languageTag}) - ${duration}ms - ${categoryCount} categories`,
        );

        return; // Success, exit retry loop
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);

        if (attempt < this.config.maxRetries) {
          const delay = this.calculateRetryDelay(attempt);
          console.log(
            `⚠️  Retry ${attempt + 1}/${this.config.maxRetries} for ${requestId} in ${delay}ms`,
          );
          await this.delay(delay);
        }
      }
    }

    // All retries failed
    const duration = Date.now() - startTime;
    const results = createTestResults(requestId, params, {
      success: false,
      duration,
      error: lastError || 'Unknown error after retries',
    });

    this.results.push(...results);

    // Write failed result to CSV
    for (const result of results) {
      await this.csvWriter.writeResult(result);
    }

    const progressPercent = ((index / total) * 100).toFixed(1);
    console.log(
      `❌ [${progressPercent}%] ${index}/${total} - ${params.address} FAILED: ${lastError}`,
    );
  }

  /**
   * Make API request to dish-categories/recommendations endpoint
   */
  private async makeApiRequest(
    params: QueryDishCategoryRecommendationsDto,
  ): Promise<ApiResponse> {
    const url = new URL(this.config.endpoint, this.config.baseUrl);

    // Add query parameters
    url.searchParams.set('address', params.address);
    url.searchParams.set('languageTag', params.languageTag);

    if (params.timeSlot) url.searchParams.set('timeSlot', params.timeSlot);
    if (params.scene) url.searchParams.set('scene', params.scene);
    if (params.mood) url.searchParams.set('mood', params.mood);
    if (params.restrictions) {
      params.restrictions.forEach((restriction) => {
        url.searchParams.append('restrictions', restriction);
      });
    }

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'dish-categories-functional-test/1.0',
        },
        // Add timeout to prevent hanging requests
        signal: AbortSignal.timeout(60000), // 60 seconds
      });

      if (!response.ok) {
        // Handle HTTP error responses
        const errorText = await response.text().catch(() => 'Unknown error');
        return {
          success: false,
          statusCode: response.status,
          error: `HTTP ${response.status}: ${errorText}`,
        };
      }

      const data: BaseResponse<QueryDishCategoryRecommendationsResponse> =
        await response.json();

      return {
        success: true,
        statusCode: response.status,
        data: data.data,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        return {
          success: false,
          error: 'Request timeout (30s)',
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = this.config.retryDelayBase * Math.pow(2, attempt);

    if (this.config.retryJitter) {
      // Add random jitter (±25%)
      const jitter = (Math.random() - 0.5) * 0.5 * baseDelay;
      return Math.max(100, baseDelay + jitter); // Minimum 100ms
    }

    return baseDelay;
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    const timestamp = Date.now().toString(36);
    const random = randomBytes(4).toString('hex');
    return `req_${timestamp}_${random}`;
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * CLI entry point
 */
export async function main(): Promise<void> {
  // Parse command line arguments
  let args = process.argv.slice(2);

  // Remove the standalone '--' separator that npm/pnpm adds
  if (args[0] === '--') {
    args = args.slice(1);
  }

  const config: Partial<TestConfig> = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];

    switch (key) {
      case '--strategy':
        config.strategy = value as any;
        break;
      case '--max-requests':
        config.maxRequests = parseInt(value);
        break;
      case '--rate-limit':
        config.requestsPerMinute = parseInt(value);
        break;
      case '--concurrency':
        config.maxConcurrent = parseInt(value);
        break;
      case '--base-url':
        config.baseUrl = value;
        break;
      case '--output':
        config.csvOutputPath = value;
        break;
      case '--help':
        printUsage();
        process.exit(0);
        break;
    }
  }

  try {
    const runner = new DishCategoriesTestRunner(config);
    await runner.run();
    process.exit(0);
  } catch (error) {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  }
}

/**
 * Print CLI usage information
 */
function printUsage(): void {
  console.log(`
Usage: node runner.js [options]

Options:
  --strategy <strategy>       Sampling strategy: cartesian, random, stratified (default: stratified)
  --max-requests <number>     Maximum number of requests (default: 100)
  --rate-limit <number>       Requests per minute (default: 30)
  --concurrency <number>      Maximum concurrent requests (default: 3)
  --base-url <url>           API base URL (default: http://localhost:3000)
  --output <path>            CSV output file path (default: ./test-results/dish-categories-recommendations.csv)
  --help                     Show this help message

Environment Variables:
  RECO_SAMPLING_STRATEGY     Same as --strategy
  RECO_MAX_REQUESTS          Same as --max-requests
  REQUESTS_PER_MINUTE        Same as --rate-limit
  MAX_CONCURRENT             Same as --concurrency
  API_BASE_URL              Same as --base-url
  CSV_OUTPUT_PATH           Same as --output

Examples:
  # Basic stratified sampling with 50 requests
  node runner.js --strategy stratified --max-requests 50

  # Random sampling with higher rate limit
  node runner.js --strategy random --max-requests 200 --rate-limit 60

  # Test against staging environment
  node runner.js --base-url https://api-staging.example.com --max-requests 30
`);
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

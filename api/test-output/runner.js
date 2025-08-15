/**
 * Main runner for dish-categories/recommendations functional testing
 * Implements rate limiting, concurrency control, and retry logic
 */
import { promises as fs } from 'fs';
import path from 'path';
import { DEFAULT_PARAMETER_SAMPLES, generateParameterCombinations, parseConfig } from './config';
import { createCsvWriter, generateRequestId, calculateStatistics } from './csv';
/**
 * Token bucket for rate limiting
 */
class TokenBucket {
    constructor(capacity, // Maximum tokens
    refillRate // Tokens per second
    ) {
        this.capacity = capacity;
        this.refillRate = refillRate;
        this.tokens = capacity;
        this.lastRefill = Date.now();
    }
    /**
     * Try to consume a token, returns true if successful
     */
    consume() {
        this.refill();
        if (this.tokens >= 1) {
            this.tokens--;
            return true;
        }
        return false;
    }
    /**
     * Wait until a token is available
     */
    async waitForToken() {
        while (!this.consume()) {
            // Calculate wait time until next token is available
            const tokensNeeded = 1 - this.tokens;
            const waitMs = (tokensNeeded / this.refillRate) * 1000;
            await new Promise(resolve => setTimeout(resolve, Math.max(100, waitMs)));
        }
    }
    /**
     * Refill tokens based on elapsed time
     */
    refill() {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        const tokensToAdd = elapsed * this.refillRate;
        this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
        this.lastRefill = now;
    }
    /**
     * Get current token count (for debugging)
     */
    getTokens() {
        this.refill();
        return this.tokens;
    }
}
/**
 * HTTP client with retry logic and timeout handling
 */
class HttpClient {
    constructor(config) {
        this.config = config;
    }
    /**
     * Make HTTP request with retry logic
     */
    async makeRequest(params) {
        let lastError;
        for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt++) {
            try {
                return await this.executeRequest(params);
            }
            catch (error) {
                lastError = error;
                // Don't retry on certain errors
                if (this.isNonRetryableError(error)) {
                    throw error;
                }
                // If this was the last attempt, throw the error
                if (attempt > this.config.maxRetries) {
                    throw lastError;
                }
                // Calculate backoff with jitter
                const backoffMs = Math.min(this.config.retryBackoffBaseMs * Math.pow(2, attempt - 1), this.config.retryBackoffMaxMs);
                const jitterMs = Math.random() * 0.1 * backoffMs; // 10% jitter
                const totalWaitMs = backoffMs + jitterMs;
                console.log(`Request failed (attempt ${attempt}), retrying in ${Math.round(totalWaitMs)}ms: ${lastError.message}`);
                await new Promise(resolve => setTimeout(resolve, totalWaitMs));
            }
        }
        throw lastError;
    }
    /**
     * Execute a single HTTP request
     */
    async executeRequest(params) {
        const url = new URL('/v1/dish-categories/recommendations', this.config.apiBaseUrl);
        // Add query parameters
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined) {
                if (Array.isArray(value)) {
                    value.forEach(v => url.searchParams.append(key, String(v)));
                }
                else {
                    url.searchParams.append(key, String(value));
                }
            }
        });
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, this.config.timeoutMs);
        try {
            const response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'dish-categories-functional-test/1.0'
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            const data = await response.json();
            // Validate response structure
            if (!Array.isArray(data)) {
                throw new Error('Response is not an array');
            }
            return data;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Request timeout after ${this.config.timeoutMs}ms`);
            }
            throw error;
        }
    }
    /**
     * Check if error should not be retried
     */
    isNonRetryableError(error) {
        if (error.message?.includes('400') || error.message?.includes('401') ||
            error.message?.includes('403') || error.message?.includes('404')) {
            return true;
        }
        return false;
    }
}
/**
 * Semaphore for controlling concurrency
 */
class Semaphore {
    constructor(permits) {
        this.waitQueue = [];
        this.permits = permits;
    }
    /**
     * Acquire a permit
     */
    async acquire() {
        if (this.permits > 0) {
            this.permits--;
            return;
        }
        return new Promise(resolve => {
            this.waitQueue.push(resolve);
        });
    }
    /**
     * Release a permit
     */
    release() {
        this.permits++;
        const nextResolve = this.waitQueue.shift();
        if (nextResolve) {
            this.permits--;
            nextResolve();
        }
    }
}
/**
 * Main test runner class
 */
export class TestRunner {
    constructor(config) {
        this.config = config;
        this.results = [];
        this.httpClient = new HttpClient(config);
        this.tokenBucket = new TokenBucket(config.requestsPerMinute, config.requestsPerMinute / 60 // Convert to tokens per second
        );
        this.semaphore = new Semaphore(config.maxConcurrent);
    }
    /**
     * Initialize the test runner
     */
    async initialize() {
        // Ensure output directory exists
        await fs.mkdir(this.config.outputDir, { recursive: true });
        // Initialize CSV writer
        const csvPath = path.join(this.config.outputDir, this.config.csvFilename);
        this.csvWriter = await createCsvWriter(csvPath);
        // Initialize log writer
        const logPath = path.join(this.config.outputDir, this.config.logFilename);
        this.logWriter = await fs.open(logPath, 'w').then(handle => handle.createWriteStream());
        this.log(`Test runner initialized with config: ${JSON.stringify(this.config, null, 2)}`);
    }
    /**
     * Run the functional tests
     */
    async run() {
        const startTime = Date.now();
        this.log('Starting functional tests...');
        try {
            // Generate parameter combinations
            const combinations = generateParameterCombinations(DEFAULT_PARAMETER_SAMPLES, this.config.strategy, this.config.maxRequests);
            this.log(`Generated ${combinations.length} parameter combinations using ${this.config.strategy} strategy`);
            // Execute tests with concurrency control
            const promises = combinations.map((params, index) => this.executeTest(params, index + 1, combinations.length));
            await Promise.all(promises);
            // Calculate and log statistics
            const stats = calculateStatistics(this.results);
            const totalTime = Date.now() - startTime;
            this.log(`Tests completed in ${totalTime}ms`);
            this.log(`Statistics: ${JSON.stringify(stats, null, 2)}`);
            return stats;
        }
        finally {
            await this.cleanup();
        }
    }
    /**
     * Execute a single test
     */
    async executeTest(params, index, total) {
        // Wait for rate limit and concurrency permits
        await this.tokenBucket.waitForToken();
        await this.semaphore.acquire();
        const requestId = generateRequestId();
        const timestamp = new Date();
        try {
            this.log(`[${index}/${total}] Starting request ${requestId}: ${JSON.stringify(params)}`);
            const startTime = Date.now();
            const response = await this.httpClient.makeRequest(params);
            const elapsedMs = Date.now() - startTime;
            const result = {
                requestId,
                request: params,
                response,
                status: 'success',
                elapsedMs,
                timestamp
            };
            this.results.push(result);
            await this.csvWriter.writeResult(result);
            this.log(`[${index}/${total}] Request ${requestId} succeeded in ${elapsedMs}ms, returned ${response.length} items`);
        }
        catch (error) {
            const elapsedMs = Date.now() - startTime;
            const status = error.message?.includes('timeout') ? 'timeout' : 'error';
            const result = {
                requestId,
                request: params,
                error: error,
                status,
                elapsedMs,
                timestamp
            };
            this.results.push(result);
            await this.csvWriter.writeResult(result);
            this.log(`[${index}/${total}] Request ${requestId} failed: ${error.message}`);
        }
        finally {
            this.semaphore.release();
        }
    }
    /**
     * Clean up resources
     */
    async cleanup() {
        await this.csvWriter?.close();
        this.logWriter?.end();
    }
    /**
     * Log message to both console and file
     */
    log(message) {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] ${message}`;
        console.log(logLine);
        this.logWriter?.write(logLine + '\n');
    }
}
/**
 * Main entry point
 */
export async function main(args = []) {
    try {
        const config = parseConfig(args);
        const runner = new TestRunner(config);
        await runner.initialize();
        const stats = await runner.run();
        console.log('\n=== Test Summary ===');
        console.log(`Total requests: ${stats.total}`);
        console.log(`Successful: ${stats.successful} (${((stats.successful / stats.total) * 100).toFixed(1)}%)`);
        console.log(`Failed: ${stats.failed} (${((stats.failed / stats.total) * 100).toFixed(1)}%)`);
        console.log(`Timed out: ${stats.timedOut} (${((stats.timedOut / stats.total) * 100).toFixed(1)}%)`);
        console.log(`Average response time: ${stats.averageElapsedMs.toFixed(1)}ms`);
        console.log(`Min response time: ${stats.minElapsedMs}ms`);
        console.log(`Max response time: ${stats.maxElapsedMs}ms`);
        if (Object.keys(stats.errorsByType).length > 0) {
            console.log('\n=== Error Types ===');
            Object.entries(stats.errorsByType).forEach(([type, count]) => {
                console.log(`${type}: ${count}`);
            });
        }
        process.exit(stats.failed > 0 ? 1 : 0);
    }
    catch (error) {
        console.error('Test runner failed:', error);
        process.exit(1);
    }
}
// Run if called directly
if (require.main === module) {
    main(process.argv.slice(2));
}

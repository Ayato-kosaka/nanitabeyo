/**
 * CSV utility for writing test results with proper escaping and formatting
 */
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
/**
 * CSV column headers
 */
export const CSV_HEADERS = [
    'request_id',
    'timestamp',
    'address',
    'timeSlot',
    'scene',
    'mood',
    'restrictions',
    'languageTag',
    'status',
    'elapsed_ms',
    'count',
    'first_category',
    'first_topicTitle',
    'first_categoryId',
    'first_imageUrl',
    'error'
];
/**
 * CSV Writer class with proper escaping and buffering
 */
export class CsvWriter {
    constructor(filePath, flushInterval = 1000 // Auto-flush every 1 second
    ) {
        this.filePath = filePath;
        this.flushInterval = flushInterval;
        this.isHeaderWritten = false;
    }
    /**
     * Initialize the CSV writer and ensure directory exists
     */
    async initialize() {
        const dir = path.dirname(this.filePath);
        await mkdir(dir, { recursive: true });
        this.writeStream = createWriteStream(this.filePath, {
            flags: 'w',
            encoding: 'utf8'
        });
        // Auto-flush periodically
        if (this.flushInterval > 0) {
            setInterval(() => {
                this.writeStream.cork();
                process.nextTick(() => this.writeStream.uncork());
            }, this.flushInterval);
        }
        await this.writeHeaders();
    }
    /**
     * Write CSV headers
     */
    async writeHeaders() {
        if (this.isHeaderWritten)
            return;
        const headerRow = CSV_HEADERS.join(',') + '\n';
        return new Promise((resolve, reject) => {
            this.writeStream.write(headerRow, (error) => {
                if (error) {
                    reject(error);
                }
                else {
                    this.isHeaderWritten = true;
                    resolve();
                }
            });
        });
    }
    /**
     * Write a test result to CSV
     */
    async writeResult(result) {
        const row = this.convertResultToCsvRow(result);
        const csvLine = this.formatCsvRow(row) + '\n';
        return new Promise((resolve, reject) => {
            this.writeStream.write(csvLine, (error) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
    }
    /**
     * Write multiple results in batch
     */
    async writeResults(results) {
        for (const result of results) {
            await this.writeResult(result);
        }
    }
    /**
     * Close the CSV writer and ensure all data is flushed
     */
    async close() {
        return new Promise((resolve, reject) => {
            this.writeStream.end((error) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
    }
    /**
     * Convert test result to CSV row format
     */
    convertResultToCsvRow(result) {
        const response = result.response;
        const firstItem = response && response.length > 0 ? response[0] : null;
        return {
            request_id: result.requestId,
            timestamp: result.timestamp.toISOString(),
            address: result.request.address || '',
            timeSlot: result.request.timeSlot || '',
            scene: result.request.scene || '',
            mood: result.request.mood || '',
            restrictions: result.request.restrictions ? JSON.stringify(result.request.restrictions) : '',
            languageTag: result.request.languageTag || '',
            status: result.status,
            elapsed_ms: result.elapsedMs,
            count: response ? response.length : 0,
            first_category: firstItem?.category || '',
            first_topicTitle: firstItem?.topicTitle || '',
            first_categoryId: firstItem?.categoryId || '',
            first_imageUrl: firstItem?.imageUrl || '',
            error: result.error ? this.sanitizeError(result.error) : ''
        };
    }
    /**
     * Format CSV row with proper escaping
     */
    formatCsvRow(row) {
        return CSV_HEADERS.map(header => {
            const value = row[header];
            return this.escapeCsvValue(String(value));
        }).join(',');
    }
    /**
     * Escape CSV value with quotes and handle special characters
     */
    escapeCsvValue(value) {
        // Handle null/undefined
        if (value === 'undefined' || value === 'null') {
            return '';
        }
        // If value contains comma, quote, or newline, wrap in quotes and escape quotes
        if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
            return '"' + value.replace(/"/g, '""') + '"';
        }
        return value;
    }
    /**
     * Sanitize error message for CSV output
     */
    sanitizeError(error) {
        let message = error.message || 'Unknown error';
        // Remove sensitive information and normalize
        message = message
            .replace(/\r?\n/g, ' ') // Remove newlines
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim()
            .substring(0, 200); // Limit length
        return message;
    }
}
/**
 * Utility function to create and initialize a CSV writer
 */
export async function createCsvWriter(filePath) {
    const writer = new CsvWriter(filePath);
    await writer.initialize();
    return writer;
}
/**
 * Generate a unique request ID
 */
export function generateRequestId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `req_${timestamp}_${random}`;
}
/**
 * Calculate statistics from test results
 */
export function calculateStatistics(results) {
    const stats = {
        total: results.length,
        successful: 0,
        failed: 0,
        timedOut: 0,
        averageElapsedMs: 0,
        minElapsedMs: Infinity,
        maxElapsedMs: 0,
        totalElapsedMs: 0,
        errorsByType: {}
    };
    if (results.length === 0) {
        stats.minElapsedMs = 0;
        return stats;
    }
    for (const result of results) {
        // Count by status
        switch (result.status) {
            case 'success':
                stats.successful++;
                break;
            case 'error':
                stats.failed++;
                break;
            case 'timeout':
                stats.timedOut++;
                break;
        }
        // Track timing
        stats.totalElapsedMs += result.elapsedMs;
        stats.minElapsedMs = Math.min(stats.minElapsedMs, result.elapsedMs);
        stats.maxElapsedMs = Math.max(stats.maxElapsedMs, result.elapsedMs);
        // Track error types
        if (result.error) {
            const errorType = result.error.constructor.name || 'UnknownError';
            stats.errorsByType[errorType] = (stats.errorsByType[errorType] || 0) + 1;
        }
    }
    stats.averageElapsedMs = stats.totalElapsedMs / stats.total;
    return stats;
}

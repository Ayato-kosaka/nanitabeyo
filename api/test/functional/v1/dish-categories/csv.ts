/**
 * CSV utility for dish-categories/recommendations functional test results
 *
 * Handles CSV output generation with proper escaping and formatting
 */

import * as fs from 'fs';
import * as path from 'path';
import type { QueryDishCategoryRecommendationsDto } from '@shared/v1/dto';
import type { QueryDishCategoryRecommendationsResponse } from '@shared/v1/res';

// Test result interface
export interface TestResult {
  categoryIndex: number; // Index of category within the request (1, 2, 3...)
  requestId: string;
  timestamp: string;
  success: boolean;
  statusCode?: number;
  duration: number; // milliseconds
  errorMessage?: string;

  // Request parameters
  address: string;
  timeSlot?: string;
  scene?: string;
  mood?: string;
  restrictions?: string[];
  languageTag: string;

  // Response summary
  responseCount?: number;

  // Category data (one category per row)
  category?: string;
  topicTitle?: string;
  reason?: string;
  categoryId?: string;
  imageUrl?: string;

  // Full response (optional)
  fullResponse?: QueryDishCategoryRecommendationsResponse;
}

// CSV header columns
const CSV_HEADERS = [
  'request_id',
  'category_index',
  'timestamp',
  'success',
  'status_code',
  'duration_ms',
  'error_message',
  'address',
  'time_slot',
  'scene',
  'mood',
  'restrictions',
  'language_tag',
  'response_count',
  'category',
  'topic_title',
  'reason',
  'category_id',
  'image_url',
] as const;

/**
 * CSV writer class for streaming results
 */
export class CsvWriter {
  private writeStream: fs.WriteStream | null = null;
  private filePath: string;
  private headerWritten = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.ensureDirectoryExists();
  }

  /**
   * Initialize CSV file with headers
   */
  async initialize(): Promise<void> {
    this.writeStream = fs.createWriteStream(this.filePath, { flags: 'w' });
    await this.writeHeaders();
  }

  /**
   * Write a test result to CSV
   */
  async writeResult(result: TestResult): Promise<void> {
    if (!this.writeStream) {
      throw new Error('CSV writer not initialized');
    }

    const row = this.formatResultAsRow(result);
    const csvLine = this.formatCsvLine(row);

    return new Promise((resolve, reject) => {
      this.writeStream!.write(csvLine + '\n', (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  /**
   * Close the CSV file
   */
  async close(): Promise<void> {
    if (this.writeStream) {
      return new Promise((resolve, reject) => {
        this.writeStream!.end((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }

  /**
   * Write CSV headers
   */
  private async writeHeaders(): Promise<void> {
    if (this.headerWritten) return;

    const headerLine = this.formatCsvLine(CSV_HEADERS);
    return new Promise((resolve, reject) => {
      this.writeStream!.write(headerLine + '\n', (error) => {
        if (error) {
          reject(error);
        } else {
          this.headerWritten = true;
          resolve();
        }
      });
    });
  }

  /**
   * Convert test result to CSV row values
   */
  private formatResultAsRow(result: TestResult): string[] {
    return [
      result.requestId,
      result.categoryIndex.toString(),
      result.timestamp,
      result.success.toString(),
      result.statusCode?.toString() || '',
      result.duration.toString(),
      result.errorMessage || '',
      result.address,
      result.timeSlot || '',
      result.scene || '',
      result.mood || '',
      result.restrictions?.join(';') || '', // Use semicolon separator for array
      result.languageTag,
      result.responseCount?.toString() || '',
      result.category || '',
      result.topicTitle || '',
      result.reason || '',
      result.categoryId || '',
      result.imageUrl || '',
    ];
  }

  /**
   * Format array of values as CSV line with proper escaping
   */
  private formatCsvLine(values: readonly string[]): string {
    return values.map((value) => this.escapeCsvValue(value)).join(',');
  }

  /**
   * Escape CSV value according to RFC 4180
   */
  private escapeCsvValue(value: string): string {
    // If value contains comma, newline, or quote, wrap in quotes and escape quotes
    if (
      value.includes(',') ||
      value.includes('\n') ||
      value.includes('\r') ||
      value.includes('"')
    ) {
      return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
  }

  /**
   * Ensure output directory exists
   */
  private ensureDirectoryExists(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Create test results from request and response
 * Returns one result per category in the response
 */
export function createTestResults(
  requestId: string,
  request: QueryDishCategoryRecommendationsDto,
  response: {
    success: boolean;
    statusCode?: number;
    duration: number;
    data?: QueryDishCategoryRecommendationsResponse;
    error?: string;
  },
): TestResult[] {
  const baseResult: Omit<
    TestResult,
    | 'categoryIndex'
    | 'category'
    | 'topicTitle'
    | 'reason'
    | 'categoryId'
    | 'imageUrl'
  > = {
    requestId,
    timestamp: new Date().toISOString(),
    success: response.success,
    statusCode: response.statusCode,
    duration: response.duration,
    errorMessage: response.error,

    // Request parameters
    address: request.address,
    timeSlot: request.timeSlot,
    scene: request.scene,
    mood: request.mood,
    restrictions: request.restrictions,
    languageTag: request.languageTag,

    // Response summary
    responseCount: response.data?.length || 0,
    fullResponse: response.data,
  };

  // If successful and has data, create one row per category with category index
  if (response.success && response.data && response.data.length > 0) {
    return response.data.map((item, index) => ({
      ...baseResult,
      categoryIndex: index + 1, // 1-based index for each category in this request
      category: item.category,
      topicTitle: item.topicTitle,
      reason: item.reason,
      categoryId: item.categoryId,
      imageUrl: item.imageUrl,
    }));
  }

  // If failed or no data, create single row with category index 1
  return [
    {
      ...baseResult,
      categoryIndex: 1,
      category: undefined,
      topicTitle: undefined,
      reason: undefined,
      categoryId: undefined,
      imageUrl: undefined,
    },
  ];
}

/**
 * Generate summary statistics from results
 */
export interface TestSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  averageResponseTime: number;
  averageResponseCount: number;
  uniqueCategories: number;
  errorsByStatus: Record<string, number>;
}

export function generateSummary(results: TestResult[]): TestSummary {
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  const averageResponseTime =
    successful.length > 0
      ? successful.reduce((sum, r) => sum + r.duration, 0) / successful.length
      : 0;

  const averageResponseCount =
    successful.length > 0
      ? successful.reduce((sum, r) => sum + (r.responseCount || 0), 0) /
        successful.length
      : 0;

  const uniqueCategories = new Set(
    successful.flatMap(
      (r) => r.fullResponse?.map((item) => item.category) || [],
    ),
  ).size;

  const errorsByStatus: Record<string, number> = {};
  failed.forEach((r) => {
    const key = r.statusCode ? r.statusCode.toString() : 'unknown';
    errorsByStatus[key] = (errorsByStatus[key] || 0) + 1;
  });

  return {
    totalRequests: results.length,
    successfulRequests: successful.length,
    failedRequests: failed.length,
    successRate: results.length > 0 ? successful.length / results.length : 0,
    averageResponseTime,
    averageResponseCount,
    uniqueCategories,
    errorsByStatus,
  };
}

/**
 * Write summary to log file
 */
export async function writeSummaryLog(
  summary: TestSummary,
  logPath: string,
): Promise<void> {
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const logContent = `
=== Dish Categories Recommendations Test Summary ===
Generated: ${new Date().toISOString()}

Results:
- Total Requests: ${summary.totalRequests}
- Successful: ${summary.successfulRequests}
- Failed: ${summary.failedRequests}
- Success Rate: ${(summary.successRate * 100).toFixed(2)}%

Performance:
- Average Response Time: ${summary.averageResponseTime.toFixed(2)}ms
- Average Response Count: ${summary.averageResponseCount.toFixed(2)}
- Unique Categories Found: ${summary.uniqueCategories}

Errors by Status Code:
${Object.entries(summary.errorsByStatus)
  .map(([status, count]) => `- ${status}: ${count}`)
  .join('\n')}
`;

  await fs.promises.writeFile(logPath, logContent);
}

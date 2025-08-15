# Dish Categories Recommendations Functional Testing Tool

A comprehensive functional testing tool for the `/v1/dish-categories/recommendations` API endpoint designed for prompt improvement and response analysis.

## Features

- **Multiple Sampling Strategies**: Cartesian product, random sampling, and stratified sampling
- **Cost Control**: Configurable request limits, rate limiting, and concurrency control
- **Robust Error Handling**: Retry logic with exponential backoff and jitter
- **CSV Output**: Detailed results with request/response summaries
- **Real-time Logging**: Progress tracking and comprehensive statistics

## Quick Start

### Prerequisites

- Node.js 18+ and pnpm
- API server running (local or staging)

### Basic Usage

```bash
# Run with default settings (100 requests, stratified sampling)
pnpm test:functional:reco

# Run with custom parameters
pnpm test:functional:reco -- --strategy random --max-requests 50 --rpm 20

# Run with specific API endpoint
pnpm test:functional:reco -- --api-url http://localhost:3000 --max-requests 25
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RECO_MAX_REQUESTS` | `100` | Maximum number of requests to send |
| `REQUESTS_PER_MINUTE` | `30` | Rate limit (requests per minute) |
| `MAX_CONCURRENT` | `3` | Maximum concurrent requests |
| `REQUEST_TIMEOUT_MS` | `30000` | Request timeout in milliseconds |
| `MAX_RETRIES` | `3` | Maximum retry attempts for failed requests |
| `RETRY_BACKOFF_BASE_MS` | `1000` | Base backoff time for retries |
| `RETRY_BACKOFF_MAX_MS` | `10000` | Maximum backoff time for retries |
| `API_BASE_URL` | `http://localhost:3000` | Base URL for API |
| `OUTPUT_DIR` | `./test-output` | Output directory for results |
| `CSV_FILENAME` | `reco-results.csv` | CSV output filename |
| `LOG_FILENAME` | `reco-run.log` | Log output filename |

### CLI Arguments

| Argument | Description | Example |
|----------|-------------|---------|
| `--strategy` | Sampling strategy: `cartesian`, `random`, `stratified` | `--strategy random` |
| `--max-requests` | Maximum number of requests | `--max-requests 50` |
| `--rpm` | Requests per minute | `--rpm 20` |
| `--concurrent` | Max concurrent requests | `--concurrent 2` |
| `--api-url` | API base URL | `--api-url http://staging.example.com` |
| `--output-dir` | Output directory | `--output-dir ./my-results` |

## Sampling Strategies

### Cartesian Product (`cartesian`)
- Generates all possible parameter combinations
- Best for comprehensive testing
- Use with small parameter sets or low `--max-requests`

### Random Sampling (`random`)
- Randomly selects parameter combinations
- Good for cost-effective broad coverage
- Each optional parameter has 50% inclusion probability

### Stratified Sampling (`stratified`) *[Default]*
- Balanced coverage across parameter values
- Ensures each address and language combination is tested
- Rotates through optional parameters systematically

## Output

### CSV Format

The CSV output contains the following columns:

| Column | Description |
|--------|-------------|
| `request_id` | Unique identifier for each request |
| `timestamp` | ISO timestamp when request was made |
| `address` | Address parameter value |
| `timeSlot` | Time slot parameter (optional) |
| `scene` | Scene parameter (optional) |
| `mood` | Mood parameter (optional) |
| `restrictions` | Restrictions array as JSON string (optional) |
| `languageTag` | Language tag parameter |
| `status` | Result status: `success`, `error`, or `timeout` |
| `elapsed_ms` | Request duration in milliseconds |
| `count` | Number of items returned in response |
| `first_category` | Category of first result item |
| `first_topicTitle` | Topic title of first result item |
| `first_categoryId` | Category ID of first result item |
| `first_imageUrl` | Image URL of first result item |
| `error` | Error message (if any) |

### Log Output

Logs are written to both console and file with timestamps, including:
- Test configuration
- Request progress and timing
- Error details
- Final statistics

## Example Usage Scenarios

### Development Testing (Fast)
```bash
RECO_MAX_REQUESTS=20 REQUESTS_PER_MINUTE=60 pnpm test:functional:reco -- --strategy random
```

### Staging Validation (Moderate)
```bash
pnpm test:functional:reco -- --strategy stratified --max-requests 100 --rpm 30 --api-url http://staging.example.com
```

### Production Analysis (Conservative)
```bash
RECO_MAX_REQUESTS=500 REQUESTS_PER_MINUTE=10 MAX_CONCURRENT=2 pnpm test:functional:reco -- --strategy cartesian
```

### Quick Smoke Test
```bash
pnpm test:functional:reco -- --max-requests 10 --rpm 60 --concurrent 1
```

## Parameter Coverage

The tool tests various combinations of:

**Required Parameters:**
- `address`: Multiple locations (Japanese cities, international cities)
- `languageTag`: 8 language codes (ja-JP, en-US, ko-KR, zh-CN, fr-FR, es-ES, ar-SA, hi-IN)

**Optional Parameters:**
- `timeSlot`: Time periods in multiple languages
- `scene`: Different dining scenarios
- `mood`: Various food preferences
- `restrictions`: Dietary restrictions and preferences

## Safety Features

- **Rate Limiting**: Token bucket algorithm prevents API overload
- **Concurrency Control**: Semaphore limits simultaneous requests
- **Retry Logic**: Exponential backoff with jitter for resilient testing
- **Timeout Handling**: Configurable timeouts prevent hanging requests
- **Error Isolation**: Failed requests don't stop the test run
- **Progress Tracking**: Real-time feedback on test progress

## Output Analysis

After running tests, you can analyze the CSV output to:

1. **Response Time Analysis**: Check `elapsed_ms` column for performance patterns
2. **Success Rate**: Compare `status` values across parameter combinations
3. **Response Quality**: Analyze `count` and first result fields for relevance
4. **Error Patterns**: Review `error` messages for common failure modes
5. **Parameter Impact**: Compare results across different parameter combinations

## Troubleshooting

### Common Issues

**"Cannot find module" errors:**
- Ensure you're running from the `api/` directory
- Check that all dependencies are installed with `pnpm install`

**Connection refused:**
- Verify the API server is running
- Check the `--api-url` parameter or `API_BASE_URL` environment variable

**Rate limiting errors:**
- Reduce `--rpm` value
- Increase retry settings
- Check API server capacity

**High error rates:**
- Verify API server health
- Check parameter validity
- Review error messages in CSV output

### Performance Tuning

**For faster execution:**
- Increase `--rpm` and `--concurrent`
- Use `random` strategy with lower `--max-requests`
- Reduce `REQUEST_TIMEOUT_MS`

**For more thorough testing:**
- Use `cartesian` strategy
- Increase `--max-requests`
- Lower `--rpm` to be API-friendly

## Files Generated

- `test-output/reco-results.csv` - Main test results
- `test-output/reco-run.log` - Detailed execution log
- Output directory is configurable via `--output-dir`

## Development

### Mock Testing

For development and testing without a live API:

```bash
node test/functional/v1/dish-categories/simple-test.js
```

This runs a self-contained test with a mock HTTP server.

### Adding New Parameters

To add new test parameters:

1. Update `DEFAULT_PARAMETER_SAMPLES` in `config.ts`
2. Modify parameter generation strategies as needed
3. Ensure CSV columns accommodate new fields

## API Endpoint Details

**Endpoint:** `GET /v1/dish-categories/recommendations`  
**Authentication:** None required (OptionalJwtAuthGuard)  
**Response:** Array of recommendation objects with category, topic, reason, ID, and image URL
# Dish Categories Recommendations Functional Test

This directory contains comprehensive functional testing tools for the `/v1/dish-categories/recommendations` API endpoint.

## Overview

The functional test suite generates parameter combinations, executes API requests with rate limiting and retry logic, and outputs results to CSV for prompt improvement analysis.

## Features

- **Multiple Sampling Strategies**: Cartesian (full combinations), Random, and Stratified sampling
- **Rate Limiting**: Token bucket algorithm with configurable requests per minute
- **Concurrency Control**: Semaphore-based concurrent request limiting
- **Retry Logic**: Exponential backoff with jitter for 429/5xx errors
- **CSV Output**: Comprehensive logging of requests, responses, and performance metrics
- **Environment Configuration**: Flexible configuration via environment variables and CLI arguments

## Files

- `config.ts` - Parameter definitions and sampling strategy implementations
- `csv.ts` - CSV output utilities and result formatting
- `runner.ts` - Main test runner with rate limiting and retry logic

## Usage

### Prerequisites

1. **Start the API server** (required for actual testing):

   ```bash
   cd api
   API_COMMIT_ID=test API_NODE_ENV=development CORS_ORIGIN=http://localhost:3000 API_GOOGLE_PLACE_API_KEY=test_key pnpm dev
   ```

2. **Verify API is running**:
   ```bash
   curl "http://localhost:3000/v1/dish-categories/recommendations?address=Tokyo%20Station&languageTag=en-US"
   ```

### Running Tests

#### Basic Usage (pnpm script)

```bash
cd api
pnpm test:functional:dish-categories
```

#### Advanced Usage (CLI arguments)

```bash
cd api
pnpm test:functional:dish-categories -- --strategy stratified --max-requests 50 --rate-limit 30
```

#### Direct execution with ts-node

```bash
cd api
npx ts-node --project tsconfig.json -r tsconfig-paths/register test/functional/v1/dish-categories/runner.ts --help
```

### Configuration Options

#### CLI Arguments

- `--strategy <strategy>` - Sampling strategy: `cartesian`, `random`, `stratified` (default: stratified)
- `--max-requests <number>` - Maximum number of requests (default: 100)
- `--rate-limit <number>` - Requests per minute (default: 30)
- `--concurrency <number>` - Maximum concurrent requests (default: 3)
- `--base-url <url>` - API base URL (default: http://localhost:3000)
- `--output <path>` - CSV output file path (default: ./test-results/dish-categories-recommendations.csv)

#### Environment Variables

- `RECO_SAMPLING_STRATEGY` - Same as --strategy
- `RECO_MAX_REQUESTS` - Same as --max-requests
- `REQUESTS_PER_MINUTE` - Same as --rate-limit
- `MAX_CONCURRENT` - Same as --concurrency
- `API_BASE_URL` - Same as --base-url
- `CSV_OUTPUT_PATH` - Same as --output

### Sampling Strategies

#### Cartesian (Full Combinations)

Generates all possible parameter combinations:

- **Pros**: Complete coverage
- **Cons**: Can generate 10,000+ requests with current parameters
- **Use case**: Comprehensive testing with high request limits

#### Random

Randomly selects parameter values for each request:

- **Pros**: Good coverage with fewer requests
- **Cons**: Not systematic, may miss edge cases
- **Use case**: Quick testing and exploration

#### Stratified (Recommended)

Evenly distributes samples across parameter space:

- **Pros**: Systematic coverage, efficient
- **Cons**: May not hit every combination
- **Use case**: Default choice for balanced testing

### Parameter Coverage

The test suite covers parameters based on the frontend implementation:

- **Addresses** (8): Tokyo Station, Shibuya, Osaka Station, Kyoto Station, Shinjuku, Ginza, Harajuku, Akihabara
- **Languages** (8): en-US, ja-JP, fr-FR, zh-CN, ar-SA, ko-KR, es-ES, hi-IN
- **Time Slots** (4): morning, lunch, dinner, late_night
- **Scenes** (5): solo, date, group, large_group, tourism
- **Moods** (7): hearty, light, sweet, spicy, healthy, junk, alcohol
- **Restrictions** (9): Various combinations of dietary restrictions

### Output Format

#### CSV Columns

- `request_id` - Unique identifier for the request
- `timestamp` - ISO timestamp of request execution
- `success` - Boolean indicating success/failure
- `status_code` - HTTP status code
- `duration_ms` - Request duration in milliseconds
- `error_message` - Error details if failed
- `address` - Location parameter
- `time_slot` - Time slot parameter
- `scene` - Scene parameter
- `mood` - Mood parameter
- `restrictions` - Dietary restrictions (semicolon-separated)
- `language_tag` - Language parameter
- `response_count` - Number of categories returned
- `first_category` - First category in response
- `first_topic_title` - First topic title in response
- `first_reason` - First reason in response
- `categories_preview` - First 3 categories (semicolon-separated)

#### Log File

Contains summary statistics:

- Total/successful/failed request counts
- Success rate percentage
- Average response time and category count
- Unique categories found
- Error breakdown by status code

### Examples

#### Small Test Run

```bash
cd api
pnpm test:functional:dish-categories -- --strategy random --max-requests 20 --rate-limit 60
```

#### Comprehensive Testing

```bash
cd api
RECO_MAX_REQUESTS=500 REQUESTS_PER_MINUTE=120 MAX_CONCURRENT=5 \
pnpm test:functional:dish-categories -- --strategy stratified
```

#### Test Against Staging

```bash
cd api
pnpm test:functional:dish-categories -- \
  --base-url https://api-staging.example.com \
  --max-requests 100 \
  --output ./staging-test-results.csv
```

### Performance Considerations

#### Cost Control

- **Rate Limiting**: Token bucket prevents API overload
- **Request Limits**: `RECO_MAX_REQUESTS` caps total requests
- **Concurrency**: `MAX_CONCURRENT` prevents too many simultaneous requests
- **Retry Logic**: Exponential backoff prevents retry storms

#### Recommended Settings

- **Development**: 30 RPM, 3 concurrent, 50-100 requests
- **Staging**: 60 RPM, 5 concurrent, 200-500 requests
- **Production**: Use with extreme caution, very low limits

### Troubleshooting

#### Common Issues

1. **"Module not found" errors**: Ensure all dependencies are installed with `pnpm install`
2. **API connection errors**: Verify the API server is running and accessible
3. **Rate limit errors**: Reduce `--rate-limit` or increase retry delays
4. **Out of memory**: Reduce `--max-requests` for large cartesian combinations

#### Debug Mode

```bash
cd api
DEBUG=* pnpm test:functional:dish-categories -- --max-requests 5
```

### Integration with CI/CD

The test can be integrated into continuous integration:

```yaml
- name: Run functional tests
  run: |
    cd api
    pnpm test:functional:dish-categories -- \
      --strategy random \
      --max-requests 50 \
      --base-url ${{ env.STAGING_API_URL }}
```

### Contributing

When modifying the test suite:

1. Update parameter lists in `config.ts` to match frontend changes
2. Maintain backward compatibility in CSV output format
3. Test with small request counts before large runs
4. Document any new configuration options

/**
 * Simple test to validate the functional testing tool
 * Uses a mock HTTP server to test the request/response flow
 */
import * as http from 'http';
import { TestRunner } from './runner';
/**
 * Create a mock API server for testing
 */
function createMockServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, `http://localhost`);
            // Mock the recommendations endpoint
            if (url.pathname === '/v1/dish-categories/recommendations') {
                const address = url.searchParams.get('address');
                const languageTag = url.searchParams.get('languageTag');
                // Simulate some processing time
                setTimeout(() => {
                    const mockResponse = [
                        {
                            category: 'Italian',
                            topicTitle: 'Best Italian Food',
                            reason: `Great Italian food near ${address}`,
                            categoryId: 'italian-001',
                            imageUrl: 'https://example.com/italian.jpg'
                        },
                        {
                            category: 'Japanese',
                            topicTitle: 'Authentic Japanese Cuisine',
                            reason: `Traditional Japanese dishes for ${address}`,
                            categoryId: 'japanese-001',
                            imageUrl: 'https://example.com/japanese.jpg'
                        }
                    ];
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(mockResponse));
                }, Math.random() * 500 + 100); // Random delay 100-600ms
            }
            else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });
        server.listen(0, () => {
            const port = server.address().port;
            resolve({ server, port });
        });
    });
}
/**
 * Test the functional testing tool
 */
async function testFunctionalTool() {
    console.log('Creating mock API server...');
    const { server, port } = await createMockServer();
    try {
        console.log(`Mock server running on port ${port}`);
        // Configure test runner
        const config = {
            strategy: 'stratified',
            maxRequests: 10,
            requestsPerMinute: 60,
            maxConcurrent: 2,
            timeoutMs: 5000,
            maxRetries: 2,
            retryBackoffBaseMs: 500,
            retryBackoffMaxMs: 2000,
            apiBaseUrl: `http://localhost:${port}`,
            outputDir: './test-output',
            csvFilename: 'test-reco-results.csv',
            logFilename: 'test-reco-run.log'
        };
        console.log('Running functional tests...');
        const runner = new TestRunner(config);
        await runner.initialize();
        const stats = await runner.run();
        console.log('\n=== Test Results ===');
        console.log(`Total requests: ${stats.total}`);
        console.log(`Successful: ${stats.successful}`);
        console.log(`Failed: ${stats.failed}`);
        console.log(`Average response time: ${stats.averageElapsedMs.toFixed(1)}ms`);
        if (stats.successful === stats.total) {
            console.log('✅ All tests passed!');
        }
        else {
            console.log('❌ Some tests failed');
        }
    }
    finally {
        server.close();
        console.log('Mock server stopped');
    }
}
// Run the test
if (require.main === module) {
    testFunctionalTool()
        .then(() => {
        console.log('Test completed successfully');
        process.exit(0);
    })
        .catch((error) => {
        console.error('Test failed:', error);
        process.exit(1);
    });
}

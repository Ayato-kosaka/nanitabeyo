/**
 * Simple Node.js test to validate our functional testing tool
 * This is a simplified version in plain JavaScript for immediate testing
 */

const http = require('http');
const fs = require('fs/promises');
const path = require('path');

// Mock parameter combinations
const mockCombinations = [
  { address: '東京都渋谷区', languageTag: 'ja-JP', timeSlot: '昼' },
  { address: 'Tokyo, Japan', languageTag: 'en-US', scene: 'business' },
  { address: '大阪府大阪市', languageTag: 'ja-JP', mood: 'さっぱり' },
  { address: 'New York, NY, USA', languageTag: 'en-US', restrictions: ['vegetarian'] },
  { address: 'London, UK', languageTag: 'en-US' }
];

// Create mock server
function createMockServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      
      if (url.pathname === '/v1/dish-categories/recommendations') {
        const address = url.searchParams.get('address');
        const languageTag = url.searchParams.get('languageTag');
        
        // Simulate processing time
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
        }, Math.random() * 300 + 50); // Random delay 50-350ms
      } else {
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

// Simple CSV writer
async function writeCSVHeader(filePath) {
  const headers = 'request_id,timestamp,address,timeSlot,scene,mood,restrictions,languageTag,status,elapsed_ms,count,first_category,first_topicTitle,first_categoryId,first_imageUrl,error\n';
  await fs.writeFile(filePath, headers, 'utf8');
}

async function appendCSVRow(filePath, result) {
  const row = [
    result.requestId,
    result.timestamp,
    result.address || '',
    result.timeSlot || '',
    result.scene || '',
    result.mood || '',
    result.restrictions ? JSON.stringify(result.restrictions) : '',
    result.languageTag || '',
    result.status,
    result.elapsedMs,
    result.count,
    result.firstCategory || '',
    result.firstTopicTitle || '',
    result.firstCategoryId || '',
    result.firstImageUrl || '',
    result.error || ''
  ].map(value => {
    const str = String(value);
    return str.includes(',') || str.includes('"') ? '"' + str.replace(/"/g, '""') + '"' : str;
  }).join(',') + '\n';
  
  await fs.appendFile(filePath, row, 'utf8');
}

// Make HTTP request
async function makeRequest(baseUrl, params) {
  const url = new URL('/v1/dish-categories/recommendations', baseUrl);
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        value.forEach(v => url.searchParams.append(key, String(v)));
      } else {
        url.searchParams.append(key, String(value));
      }
    }
  });

  return new Promise((resolve, reject) => {
    const req = http.get(url.toString(), { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error('Invalid JSON response'));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Generate request ID
function generateRequestId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 7);
  return `req_${timestamp}_${random}`;
}

// Main test function
async function runTest() {
  console.log('🚀 Starting functional test...');
  
  const { server, port } = await createMockServer();
  console.log(`📡 Mock server running on port ${port}`);
  
  try {
    // Prepare output directory
    const outputDir = './test-output';
    await fs.mkdir(outputDir, { recursive: true });
    
    const csvPath = path.join(outputDir, 'simple-test-results.csv');
    await writeCSVHeader(csvPath);
    
    const results = [];
    
    // Execute tests
    for (let i = 0; i < mockCombinations.length; i++) {
      const params = mockCombinations[i];
      const requestId = generateRequestId();
      const startTime = Date.now();
      
      console.log(`[${i + 1}/${mockCombinations.length}] Testing: ${JSON.stringify(params)}`);
      
      try {
        const response = await makeRequest(`http://localhost:${port}`, params);
        const elapsedMs = Date.now() - startTime;
        
        const result = {
          requestId,
          timestamp: new Date().toISOString(),
          ...params,
          status: 'success',
          elapsedMs,
          count: response.length,
          firstCategory: response[0]?.category || '',
          firstTopicTitle: response[0]?.topicTitle || '',
          firstCategoryId: response[0]?.categoryId || '',
          firstImageUrl: response[0]?.imageUrl || '',
          error: ''
        };
        
        results.push(result);
        await appendCSVRow(csvPath, result);
        
        console.log(`✅ Success: ${elapsedMs}ms, ${response.length} items`);
      } catch (error) {
        const elapsedMs = Date.now() - startTime;
        
        const result = {
          requestId,
          timestamp: new Date().toISOString(),
          ...params,
          status: error.message.includes('timeout') ? 'timeout' : 'error',
          elapsedMs,
          count: 0,
          error: error.message
        };
        
        results.push(result);
        await appendCSVRow(csvPath, result);
        
        console.log(`❌ Failed: ${error.message}`);
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Calculate statistics
    const successful = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'error').length;
    const timedOut = results.filter(r => r.status === 'timeout').length;
    const avgTime = results.reduce((sum, r) => sum + r.elapsedMs, 0) / results.length;
    
    console.log('\n📊 Test Summary:');
    console.log(`Total requests: ${results.length}`);
    console.log(`Successful: ${successful} (${((successful / results.length) * 100).toFixed(1)}%)`);
    console.log(`Failed: ${failed}`);
    console.log(`Timed out: ${timedOut}`);
    console.log(`Average response time: ${avgTime.toFixed(1)}ms`);
    console.log(`CSV output: ${csvPath}`);
    
    if (successful === results.length) {
      console.log('\n🎉 All tests passed!');
    }
    
  } finally {
    server.close();
    console.log('🛑 Mock server stopped');
  }
}

// Run the test
runTest()
  .then(() => {
    console.log('\n✨ Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Test failed:', error);
    process.exit(1);
  });
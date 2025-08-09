// Quick test to validate CLS functionality after fix
const { Test } = require('@nestjs/testing');
const { ClsService } = require('nestjs-cls');
const { RequestIdModule } = require('./api/src/core/request-id/request-id.module');
const { RequestIdMiddleware } = require('./api/src/core/request-id/request-id.middleware');
const { ResponseWrapInterceptor } = require('./api/src/core/interceptors/response-wrap.interceptor');
const { CLS_KEY_REQUEST_ID } = require('./api/src/core/cls/cls.constants');

async function testCLS() {
  try {
    console.log('Creating test module...');
    const moduleRef = await Test.createTestingModule({
      imports: [RequestIdModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const clsService = app.get(ClsService);
    console.log('ClsService created:', !!clsService);

    // Test basic CLS operations
    console.log('Testing CLS store operations...');
    
    // This simulates what happens in a real request
    await clsService.run(async () => {
      clsService.set(CLS_KEY_REQUEST_ID, 'test-request-123');
      const retrievedId = clsService.get(CLS_KEY_REQUEST_ID);
      console.log('Set request ID:', 'test-request-123');
      console.log('Retrieved request ID:', retrievedId);
      console.log('CLS working correctly:', retrievedId === 'test-request-123');
    });

    await app.close();
    console.log('Test completed successfully!');
    return true;
  } catch (error) {
    console.error('Test failed:', error.message);
    return false;
  }
}

testCLS().then(success => {
  process.exit(success ? 0 : 1);
});
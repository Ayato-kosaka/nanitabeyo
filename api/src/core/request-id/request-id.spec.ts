import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { RequestIdModule } from './request-id.module';
import { CLS_KEY_REQUEST_ID } from '../cls/cls.constants';

describe('CLS Request ID', () => {
  let app;
  let clsService: ClsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RequestIdModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    clsService = app.get(ClsService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('should be able to set and get request ID from CLS', async () => {
    await clsService.run(async () => {
      const testRequestId = 'test-request-123';
      clsService.set(CLS_KEY_REQUEST_ID, testRequestId);
      
      const retrievedId = clsService.get<string>(CLS_KEY_REQUEST_ID);
      
      expect(retrievedId).toBe(testRequestId);
      expect(retrievedId).not.toBeNull();
      expect(retrievedId).not.toBeUndefined();
    });
  });

  it('should return undefined when request ID is not set', () => {
    // Outside of clsService.run(), there should be no context
    const retrievedId = clsService.get<string>(CLS_KEY_REQUEST_ID);
    expect(retrievedId).toBeUndefined();
  });
});
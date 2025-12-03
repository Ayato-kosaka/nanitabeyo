// api/src/core/logger/logger.service.spec.ts
//
// #487 【設計】Cloud Logging 向け JSON 出力のテスト
//

// Set minimal env variables before importing
process.env.API_COMMIT_ID = 'test-commit';
process.env.API_NODE_ENV = 'test';
process.env.CORS_ORIGIN = '*';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.DB_SCHEMA = 'public';
process.env.SUPABASE_JWT_SECRET = 'secret';
process.env.GOOGLE_PLACE_API_KEY = 'key';
process.env.GCS_BUCKET_NAME = 'bucket';
process.env.GCS_BUCKET_PUBLIC_NAME = 'public-bucket';
process.env.GCS_STATIC_MASTER_DIR_PATH = 'path';
process.env.CLAUDE_API_KEY = 'key';
process.env.GOOGLE_API_KEY = 'key';
process.env.GOOGLE_SEARCH_ENGINE_ID = 'id';
process.env.GCP_PROJECT = 'proj';
process.env.TASKS_LOCATION = 'loc';
process.env.TRANSCODER_LOCATION = 'loc';
process.env.TRANSCODER_PUBSUB_TOPIC = 'topic';
process.env.CLOUD_RUN_URL = 'url';
process.env.TASKS_INVOKER_SA = 'sa';
process.env.PUBSUB_PUSH_SA = 'sa';
process.env.CDN_HOST = 'cdn.example.com';
process.env.CDN_KEY_NAME = 'key-name';
process.env.CDN_KEY_SECRET_B64 = Buffer.from('test-key').toString('base64');
process.env.CDN_PUBLIC_HOST = 'cdn-public.example.com';

import { Test, TestingModule } from '@nestjs/testing';
import { AppLoggerService } from './logger.service';
import { ClsService } from 'nestjs-cls';

// Mock console.log to capture output
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

describe('AppLoggerService', () => {
  let service: AppLoggerService;
  let mockClsService: jest.Mocked<ClsService>;

  beforeEach(async () => {
    mockConsoleLog.mockClear();

    const mockCls = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppLoggerService,
        {
          provide: ClsService,
          useValue: mockCls,
        },
      ],
    }).compile();

    service = module.get<AppLoggerService>(AppLoggerService);
    mockClsService = module.get(ClsService);
  });

  afterAll(() => {
    mockConsoleLog.mockRestore();
  });

  describe('logBackendEvent (via log method)', () => {
    it('should output backend_event_logs JSON to stdout', () => {
      mockClsService.get.mockImplementation((key: string) => {
        if (key === 'reqId') return 'test-request-id';
        if (key === 'userId') return 'test-user-id';
        return undefined;
      });

      service.log('test_event', 'test_function', { foo: 'bar' });

      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      const logOutput = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(parsed.log_type).toBe('backend_event_logs');
      expect(parsed.event_name).toBe('test_event');
      expect(parsed.error_level).toBe('log');
      expect(parsed.function_name).toBe('test_function');
      expect(parsed.user_id).toBe('test-user-id');
      expect(parsed.request_id).toBe('test-request-id');
      expect(parsed.payload).toEqual({ foo: 'bar' });
      expect(parsed.id).toBeDefined();
      expect(parsed.created_commit_id).toBeDefined();
    });
  });

  describe('externalApi', () => {
    it('should output external_api_logs JSON to stdout', async () => {
      mockClsService.get.mockImplementation((key: string) => {
        if (key === 'reqId') return 'test-request-id';
        if (key === 'userId') return 'test-user-id';
        return undefined;
      });

      await service.externalApi({
        function_name: 'test_api_call',
        api_name: 'TestAPI',
        endpoint: 'https://example.com/api',
        method: 'GET',
        request_payload: { query: 'test' },
        response_payload: { result: 'success' },
        status_code: 200,
        error_message: null,
        response_time_ms: 123,
      });

      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      const logOutput = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(parsed.log_type).toBe('external_api_logs');
      expect(parsed.function_name).toBe('test_api_call');
      expect(parsed.api_name).toBe('TestAPI');
      expect(parsed.endpoint).toBe('https://example.com/api');
      expect(parsed.method).toBe('GET');
      expect(parsed.status_code).toBe(200);
      expect(parsed.response_time_ms).toBe(123);
      expect(parsed.user_id).toBe('test-user-id');
      expect(parsed.request_id).toBe('test-request-id');
      expect(parsed.id).toBeDefined();
      expect(parsed.created_commit_id).toBeDefined();
    });
  });

  describe('logFrontendEvent', () => {
    it('should output frontend_event_logs JSON to stdout', async () => {
      await service.logFrontendEvent({
        id: 'test-frontend-id',
        event_name: 'click_button',
        user_id: 'test-user-id',
        path_name: '/home',
        payload: '{"button":"submit"}',
        error_level: 'log',
        created_app_version: '1.0.0',
        created_commit_id: 'abc123',
      });

      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      const logOutput = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(parsed.log_type).toBe('frontend_event_logs');
      expect(parsed.id).toBe('test-frontend-id');
      expect(parsed.event_name).toBe('click_button');
      expect(parsed.user_id).toBe('test-user-id');
      expect(parsed.path_name).toBe('/home');
      expect(parsed.payload).toBe('{"button":"submit"}');
      expect(parsed.error_level).toBe('log');
      expect(parsed.created_app_version).toBe('1.0.0');
      expect(parsed.created_commit_id).toBe('abc123');
    });
  });
});

// api/src/v1/logs/logs.service.spec.ts
//
// #487 【設計】LogsService の AppLoggerService 統合テスト
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
import { LogsService } from './logs.service';
import { AppLoggerService } from '../../core/logger/logger.service';

describe('LogsService', () => {
  let service: LogsService;
  let mockLogger: jest.Mocked<AppLoggerService>;

  beforeEach(async () => {
    const mockLoggerService = {
      logFrontendEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogsService,
        {
          provide: AppLoggerService,
          useValue: mockLoggerService,
        },
      ],
    }).compile();

    service = module.get<LogsService>(LogsService);
    mockLogger = module.get(AppLoggerService);

    jest.clearAllMocks();
  });

  describe('createFrontendLog', () => {
    it('should call AppLoggerService.logFrontendEvent with correct parameters', async () => {
      const dto = {
        event_name: 'button_click',
        path_name: '/home',
        payload: { button: 'submit' },
        error_level: 'log' as const,
        created_at: '2024-01-01T00:00:00.000Z',
        created_app_version: '1.0.0',
        created_commit_id: 'abc123',
      };
      const userId = 'test-user-id';

      const result = await service.createFrontendLog(dto, userId);

      expect(result).toEqual({ received: true });
      expect(mockLogger.logFrontendEvent).toHaveBeenCalledTimes(1);

      const callArgs = mockLogger.logFrontendEvent.mock.calls[0][0];
      expect(callArgs.event_name).toBe('button_click');
      expect(callArgs.user_id).toBe('test-user-id');
      expect(callArgs.path_name).toBe('/home');
      expect(callArgs.payload).toEqual({ button: 'submit' });
      expect(callArgs.error_level).toBe('log');
      expect(callArgs.created_at).toBe('2024-01-01T00:00:00.000Z');
      expect(callArgs.created_app_version).toBe('1.0.0');
      expect(callArgs.created_commit_id).toBe('abc123');
      expect(callArgs.id).toBeDefined();
    });

    it('should return received:true even if logFrontendEvent throws', async () => {
      const dto = {
        event_name: 'error_event',
        path_name: '/error',
        payload: {},
        error_level: 'error' as const,
        created_at: '2024-01-01T00:00:00.000Z',
        created_app_version: '1.0.0',
        created_commit_id: 'abc123',
      };
      const userId = 'test-user-id';

      mockLogger.logFrontendEvent.mockRejectedValue(
        new Error('Log write failed'),
      );

      const result = await service.createFrontendLog(dto, userId);

      expect(result).toEqual({ received: true });
      expect(mockLogger.logFrontendEvent).toHaveBeenCalledTimes(1);
    });
  });
});

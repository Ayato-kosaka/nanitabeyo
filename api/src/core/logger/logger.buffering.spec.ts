import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { AppLoggerService } from './logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { 
  CLS_KEY_REQUEST_ID, 
  CLS_KEY_USER_ID, 
  CLS_KEY_API_LOG_BUFFER, 
  CLS_KEY_BE_LOG_BUFFER 
} from '../cls/cls.constants';
import { LogLevel } from './logger.constants';

// Mock PrismaService
const mockPrismaService = {
  prisma: {
    backend_event_logs: {
      create: jest.fn(),
      createMany: jest.fn(),
    },
    external_api_logs: {
      create: jest.fn(),
      createMany: jest.fn(),
    },
  },
};

describe('AppLoggerService Buffering', () => {
  let loggerService: AppLoggerService;
  let clsService: ClsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AppLoggerService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ClsService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
          },
        },
      ],
    }).compile();

    loggerService = module.get<AppLoggerService>(AppLoggerService);
    clsService = module.get<ClsService>(ClsService);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('Backend Event Log Buffering', () => {
    it('should enqueue backend event logs to buffer instead of direct DB write', async () => {
      // Setup CLS mocks
      const mockBuffer = [];
      (clsService.get as jest.Mock)
        .mockReturnValueOnce('test-request-id')
        .mockReturnValueOnce('test-user-id')
        .mockReturnValueOnce(mockBuffer);

      // Call logger method
      loggerService.log('testEvent', 'testFunction', { test: 'data' });

      // Verify no direct DB call was made
      expect(mockPrismaService.prisma.backend_event_logs.create).not.toHaveBeenCalled();

      // Verify CLS buffer was accessed and updated
      expect(clsService.get).toHaveBeenCalledWith(CLS_KEY_BE_LOG_BUFFER);
      expect(clsService.set).toHaveBeenCalledWith(CLS_KEY_BE_LOG_BUFFER, expect.any(Array));
    });

    it('should handle buffer overflow by discarding oldest entries', async () => {
      // Create a buffer at the threshold limit
      const existingBuffer = new Array(500).fill(null).map((_, i) => ({
        id: `test-id-${i}`,
        event_name: 'old-event',
        function_name: 'old-function',
        error_level: LogLevel.log,
        payload: {},
        user_id: 'test-user',
        request_id: 'test-request',
        created_at: new Date(),
        created_commit_id: 'test-commit',
      }));

      (clsService.get as jest.Mock)
        .mockReturnValueOnce('test-request-id')
        .mockReturnValueOnce('test-user-id')
        .mockReturnValueOnce(existingBuffer);

      // Mock console.warn to check overflow warning
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      // Call logger method (this should trigger overflow protection)
      loggerService.log('newEvent', 'newFunction', { test: 'data' });

      // Verify overflow warning was logged
      expect(consoleSpy).toHaveBeenCalledWith(
        'Backend event log buffer overflow, discarding oldest entries',
        expect.objectContaining({
          bufferSize: 500,
          threshold: 500,
        })
      );

      // Verify buffer was trimmed and new entry was added
      expect(clsService.set).toHaveBeenCalledWith(
        CLS_KEY_BE_LOG_BUFFER,
        expect.arrayContaining([
          expect.objectContaining({
            event_name: 'newEvent',
            function_name: 'newFunction',
          })
        ])
      );

      consoleSpy.mockRestore();
    });
  });

  describe('External API Log Buffering', () => {
    it('should enqueue external API logs to buffer instead of direct DB write', async () => {
      // Setup CLS mocks
      const mockBuffer = [];
      (clsService.get as jest.Mock)
        .mockReturnValueOnce('test-user-id')
        .mockReturnValueOnce('test-request-id')
        .mockReturnValueOnce(mockBuffer);

      // Call external API logger method
      await loggerService.externalApi({
        api_name: 'test-api',
        endpoint: '/test',
        method: 'GET',
        status_code: 200,
        response_time_ms: 100,
        function_name: 'testFunction',
        request_payload: { query: 'test' },
        response_payload: null,
        error_message: null,
      });

      // Verify no direct DB call was made
      expect(mockPrismaService.prisma.external_api_logs.create).not.toHaveBeenCalled();

      // Verify CLS buffer was accessed and updated
      expect(clsService.get).toHaveBeenCalledWith(CLS_KEY_API_LOG_BUFFER);
      expect(clsService.set).toHaveBeenCalledWith(CLS_KEY_API_LOG_BUFFER, expect.any(Array));
    });

    it('should include optional fields in external API logs', async () => {
      const mockBuffer = [];
      (clsService.get as jest.Mock)
        .mockReturnValueOnce('test-user-id')
        .mockReturnValueOnce('test-request-id')
        .mockReturnValueOnce(mockBuffer);

      await loggerService.externalApi({
        api_name: 'test-api',
        endpoint: '/test',
        method: 'POST',
        status_code: 500,
        response_time_ms: 2000,
        function_name: 'testFunction',
        request_payload: { body: 'test data' },
        error_message: 'API Error',
        response_payload: { error: 'Internal server error' },
      });

      // Verify the log entry was added to buffer with all fields
      expect(clsService.set).toHaveBeenCalledWith(
        CLS_KEY_API_LOG_BUFFER,
        expect.arrayContaining([
          expect.objectContaining({
            api_name: 'test-api',
            endpoint: '/test',
            method: 'POST',
            status_code: 500,
            response_time_ms: 2000,
            request_payload: { body: 'test data' },
            error_message: 'API Error',
            response_payload: { error: 'Internal server error' },
          })
        ])
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle CLS errors gracefully and log to console', async () => {
      // Mock CLS to throw an error
      (clsService.get as jest.Mock).mockImplementation(() => {
        throw new Error('CLS Error');
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // Call logger method
      loggerService.log('testEvent', 'testFunction', { test: 'data' });

      // Verify error was logged to console
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to enqueue backend event log:',
        expect.objectContaining({
          error: 'CLS Error',
        })
      );

      consoleSpy.mockRestore();
    });
  });
});
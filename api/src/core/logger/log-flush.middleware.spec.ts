import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { LogFlushMiddleware } from './log-flush.middleware';
import { PrismaService } from '../../prisma/prisma.service';
import { 
  CLS_KEY_API_LOG_BUFFER, 
  CLS_KEY_BE_LOG_BUFFER 
} from '../cls/cls.constants';
import { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';

// Mock PrismaService
const mockPrismaService = {
  prisma: {
    backend_event_logs: {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    external_api_logs: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  },
};

// Mock Express Request/Response
const createMockReq = (): Partial<Request> => ({});

const createMockRes = (): Response => {
  const res = new EventEmitter() as any;
  res.status = jest.fn().mockReturnThis();
  res.json = jest.fn().mockReturnThis();
  res.send = jest.fn().mockReturnThis();
  res.emit = res.emit.bind(res);
  return res as Response;
};

describe('LogFlushMiddleware', () => {
  let middleware: LogFlushMiddleware;
  let clsService: ClsService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        LogFlushMiddleware,
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

    middleware = module.get<LogFlushMiddleware>(LogFlushMiddleware);
    clsService = module.get<ClsService>(ClsService);
    prismaService = module.get<PrismaService>(PrismaService);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('Buffer Initialization', () => {
    it('should initialize empty buffers at request start', () => {
      const req = createMockReq();
      const res = createMockRes();
      const next: NextFunction = jest.fn();

      middleware.use(req as Request, res, next);

      // Verify buffers were initialized
      expect(clsService.set).toHaveBeenCalledWith(CLS_KEY_BE_LOG_BUFFER, []);
      expect(clsService.set).toHaveBeenCalledWith(CLS_KEY_API_LOG_BUFFER, []);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Log Flushing', () => {
    it('should flush backend event logs when response finishes', async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next: NextFunction = jest.fn();

      // Mock buffers with sample data
      const backendLogs = [
        {
          id: 'log-1',
          event_name: 'test-event-1',
          function_name: 'test-function-1',
          error_level: 'log' as any,
          payload: { test: 'data1' },
          user_id: 'user-1',
          request_id: 'req-1',
          created_at: new Date(),
          created_commit_id: 'commit-1',
        },
        {
          id: 'log-2',
          event_name: 'test-event-2',
          function_name: 'test-function-2',
          error_level: 'error' as any,
          payload: { test: 'data2' },
          user_id: 'user-1',
          request_id: 'req-1',
          created_at: new Date(),
          created_commit_id: 'commit-1',
        },
      ];

      (clsService.get as jest.Mock)
        .mockReturnValueOnce(backendLogs) // BE buffer
        .mockReturnValueOnce([]); // API buffer

      // Setup middleware
      middleware.use(req as Request, res as Response, next);

      // Simulate response finish
      res.emit('finish');

      // Wait for setImmediate to execute
      await new Promise(resolve => setImmediate(resolve));

      // Verify createMany was called with correct data
      expect(mockPrismaService.prisma.backend_event_logs.createMany).toHaveBeenCalledWith({
        data: backendLogs,
        skipDuplicates: true,
      });
    });

    it('should flush external API logs when response finishes', async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next: NextFunction = jest.fn();

      // Mock buffers with sample data
      const apiLogs = [
        {
          id: 'api-log-1',
          api_name: 'google-places',
          endpoint: '/places/search',
          method: 'GET',
          status_code: 200,
          response_time_ms: 150,
          function_name: 'searchPlaces',
          request_payload: { query: 'restaurant' },
          user_id: 'user-1',
          request_id: 'req-1',
          created_at: new Date(),
          created_commit_id: 'commit-1',
        },
      ];

      (clsService.get as jest.Mock)
        .mockReturnValueOnce([]) // BE buffer
        .mockReturnValueOnce(apiLogs); // API buffer

      // Setup middleware
      middleware.use(req as Request, res as Response, next);

      // Simulate response finish
      res.emit('finish');

      // Wait for setImmediate to execute
      await new Promise(resolve => setImmediate(resolve));

      // Verify createMany was called with correct data
      expect(mockPrismaService.prisma.external_api_logs.createMany).toHaveBeenCalledWith({
        data: apiLogs,
        skipDuplicates: true,
      });
    });

    it('should handle large batches by chunking', async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next: NextFunction = jest.fn();

      // Create 500 log entries (more than LOG_BATCH_MAX of 200)
      const largeBatch = Array.from({ length: 500 }, (_, i) => ({
        id: `log-${i}`,
        event_name: `event-${i}`,
        function_name: 'test-function',
        error_level: 'log' as any,
        payload: { index: i },
        user_id: 'user-1',
        request_id: 'req-1',
        created_at: new Date(),
        created_commit_id: 'commit-1',
      }));

      (clsService.get as jest.Mock)
        .mockReturnValueOnce(largeBatch) // BE buffer
        .mockReturnValueOnce([]); // API buffer

      // Setup middleware
      middleware.use(req as Request, res as Response, next);

      // Simulate response finish
      res.emit('finish');

      // Wait for setImmediate to execute
      await new Promise(resolve => setImmediate(resolve));

      // Verify createMany was called 3 times (500 items / 200 max = 3 chunks)
      expect(mockPrismaService.prisma.backend_event_logs.createMany).toHaveBeenCalledTimes(3);

      // Verify chunk sizes: 200, 200, 100
      const calls = mockPrismaService.prisma.backend_event_logs.createMany.mock.calls;
      expect(calls[0][0].data).toHaveLength(200);
      expect(calls[1][0].data).toHaveLength(200);
      expect(calls[2][0].data).toHaveLength(100);
    });

    it('should handle empty buffers gracefully', async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next: NextFunction = jest.fn();

      (clsService.get as jest.Mock)
        .mockReturnValueOnce([]) // Empty BE buffer
        .mockReturnValueOnce([]); // Empty API buffer

      // Setup middleware
      middleware.use(req as Request, res as Response, next);

      // Simulate response finish
      res.emit('finish');

      // Wait for setImmediate to execute
      await new Promise(resolve => setImmediate(resolve));

      // Verify no DB calls were made for empty buffers
      expect(mockPrismaService.prisma.backend_event_logs.createMany).not.toHaveBeenCalled();
      expect(mockPrismaService.prisma.external_api_logs.createMany).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle DB errors gracefully and log to console', async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next: NextFunction = jest.fn();

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // Mock DB error
      mockPrismaService.prisma.backend_event_logs.createMany.mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const backendLogs = [
        {
          id: 'log-1',
          event_name: 'test-event',
          function_name: 'test-function',
          error_level: 'log' as any,
          payload: { test: 'data' },
          user_id: 'user-1',
          request_id: 'req-1',
          created_at: new Date(),
          created_commit_id: 'commit-1',
        },
      ];

      (clsService.get as jest.Mock)
        .mockReturnValueOnce(backendLogs) // BE buffer
        .mockReturnValueOnce([]); // API buffer

      // Setup middleware
      middleware.use(req as Request, res as Response, next);

      // Simulate response finish
      res.emit('finish');

      // Wait for setImmediate to execute
      await new Promise(resolve => setImmediate(resolve));

      // Verify error was logged to console
      expect(consoleSpy).toHaveBeenCalledWith(
        'Backend event logs flush error:',
        expect.objectContaining({
          error: 'Database connection failed',
          count: 1,
        })
      );

      consoleSpy.mockRestore();
    });
  });
});
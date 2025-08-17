import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { LogFlushMiddleware } from './log-flush.middleware';
import { PrismaService } from '../../prisma/prisma.service';

// Simple test to verify the middleware compiles and can be instantiated
describe('LogFlushMiddleware', () => {
  let middleware: LogFlushMiddleware;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        LogFlushMiddleware,
        {
          provide: PrismaService,
          useValue: {
            prisma: {
              backend_event_logs: {
                createMany: jest.fn(),
              },
              external_api_logs: {
                createMany: jest.fn(),
              },
            },
          },
        },
        {
          provide: ClsService,
          useValue: {
            get: jest.fn().mockReturnValue([]),
            set: jest.fn(),
          },
        },
      ],
    }).compile();

    middleware = module.get<LogFlushMiddleware>(LogFlushMiddleware);
  });

  it('should be defined', () => {
    expect(middleware).toBeDefined();
  });

  it('should have use method', () => {
    expect(typeof middleware.use).toBe('function');
  });
});
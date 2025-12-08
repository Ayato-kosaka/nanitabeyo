import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { CLS_KEY_USER_ID } from '../cls/cls.constants';

// helper to create mock execution context with headers
const createCtx = (headers: Record<string, string> = {}): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  }) as unknown as ExecutionContext;

// set minimal env variables required by env.ts
const setEnv = (nodeEnv = 'test') => {
  process.env.API_COMMIT_ID = 'test';
  process.env.API_NODE_ENV = nodeEnv;
  process.env.CORS_ORIGIN = '*';
  process.env.DB_SCHEMA = 'public';
  process.env.SUPABASE_JWT_SECRET = 'secret';
  process.env.GOOGLE_PLACE_API_KEY = 'key';
  process.env.GCS_BUCKET_NAME = 'bucket';
  process.env.GCS_STATIC_MASTER_DIR_PATH = 'path';
  process.env.CLAUDE_API_KEY = 'key';
  process.env.GOOGLE_API_KEY = 'key';
  process.env.GOOGLE_SEARCH_ENGINE_ID = 'id';
  process.env.GCP_PROJECT = 'proj';
  process.env.TASKS_LOCATION = 'loc';
  process.env.CLOUD_RUN_URL = 'url';
  process.env.TASKS_INVOKER_SA = 'sa';
};

describe('Auth Guards', () => {
  let ClsService: any;
  let AuthUserGuard: any;
  let AuthAnonGuard: any;
  let AppLoggerService: any;
  let AuthUserGuard: any;
  let AuthAnonGuard: any;
  let clsService: any;

  beforeEach(async () => {
    setEnv('test');
    jest.resetModules();
    jest.doMock('../logger/logger.service', () => ({
      AppLoggerService: class {
        log = jest.fn();
        warn = jest.fn();
      },
    }));
    ({ ClsService } = await import('nestjs-cls'));
    ({ AuthUserGuard, AuthAnonGuard } = await import('./auth.guard'));
    ({ AppLoggerService } = await import('../logger/logger.service'));

    const mockCls = { set: jest.fn(), get: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthUserGuard,
        AuthAnonGuard,
        { provide: ClsService, useValue: mockCls },
        {
          provide: AppLoggerService,
          useValue: { log: jest.fn(), warn: jest.fn() },
        },
      ],
    }).compile();

    AuthUserGuard = module.get(AuthUserGuard);
    AuthAnonGuard = module.get(AuthAnonGuard);
    clsService = mockCls;
  });

  describe('AuthUserGuard', () => {
    it('passes when user is fully logged in', () => {
      const user = { id: 'uid', isAnonymous: false };
      const res = AuthUserGuard.handleRequest(null, user, null, createCtx());
      expect(clsService.set).toHaveBeenCalledWith(CLS_KEY_USER_ID, 'uid');
      expect(res).toBe(user);
    });

    it('throws ForbiddenException when user is anonymous', () => {
      const user = { id: 'anon', isAnonymous: true };
      expect(() =>
        AuthUserGuard.handleRequest(null, user, null, createCtx()),
      ).toThrow(ForbiddenException);
    });

    it('throws UnauthorizedException when user is missing', () => {
      expect(() =>
        AuthUserGuard.handleRequest(null, undefined, null, createCtx()),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('AuthAnonGuard in production', () => {
    beforeEach(async () => {
      setEnv('production');
      jest.resetModules();
      jest.doMock('../logger/logger.service', () => ({
        AppLoggerService: class {
          log = jest.fn();
          warn = jest.fn();
        },
      }));
      ({ ClsService } = await import('nestjs-cls'));
      ({ AuthAnonGuard } = await import('./auth.guard'));
      ({ AppLoggerService } = await import('../logger/logger.service'));

      const mockCls = { set: jest.fn(), get: jest.fn() };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthAnonGuard,
          { provide: ClsService, useValue: mockCls },
          {
            provide: AppLoggerService,
            useValue: { log: jest.fn(), warn: jest.fn() },
          },
        ],
      }).compile();

      AuthAnonGuard = module.get(AuthAnonGuard);
      clsService = mockCls;
    });

    it('throws UnauthorizedException when token is missing', () => {
      expect(() =>
        AuthAnonGuard.handleRequest(null, undefined, null, createCtx()),
      ).toThrow(UnauthorizedException);
    });

    it('allows anonymous users with valid token', () => {
      const user = { id: 'anon', isAnonymous: true };
      const res = AuthAnonGuard.handleRequest(
        null,
        user,
        null,
        createCtx({ authorization: 'Bearer token' }),
      );
      expect(clsService.set).toHaveBeenCalledWith(CLS_KEY_USER_ID, 'anon');
      expect(res).toBe(user);
    });
  });

  describe('AuthAnonGuard in development', () => {
    beforeEach(async () => {
      setEnv('development');
      jest.resetModules();
      jest.doMock('../logger/logger.service', () => ({
        AppLoggerService: class {
          log = jest.fn();
          warn = jest.fn();
        },
      }));
      ({ ClsService } = await import('nestjs-cls'));
      ({ AuthAnonGuard } = await import('./auth.guard'));
      ({ AppLoggerService } = await import('../logger/logger.service'));

      const mockCls = { set: jest.fn(), get: jest.fn() };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthAnonGuard,
          { provide: ClsService, useValue: mockCls },
          {
            provide: AppLoggerService,
            useValue: { log: jest.fn(), warn: jest.fn() },
          },
        ],
      }).compile();

      AuthAnonGuard = module.get(AuthAnonGuard);
      clsService = mockCls;
    });

    it('returns mock user when token is missing', () => {
      const res = AuthAnonGuard.handleRequest(
        null,
        undefined,
        null,
        createCtx(),
      );
      expect(res.id).toBe('dev-mock-user');
      expect(clsService.set).toHaveBeenCalledWith(
        CLS_KEY_USER_ID,
        'dev-mock-user',
      );
    });

    it('returns real user when token is provided', () => {
      const user = { id: 'real', isAnonymous: false };
      const res = AuthAnonGuard.handleRequest(
        null,
        user,
        null,
        createCtx({ authorization: 'Bearer token' }),
      );
      expect(res).toBe(user);
      expect(clsService.set).toHaveBeenCalledWith(CLS_KEY_USER_ID, 'real');
    });
  });
});

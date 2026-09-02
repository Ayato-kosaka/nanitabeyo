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
import { UNKNOWN_BUILD_META_SERVER } from '@shared/v1/dto';
import { LogsService } from './logs.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { RejectedFrontendLogSummary } from './frontend-log-batch.pipe';

describe('LogsService', () => {
  let service: LogsService;
  let mockLogger: jest.Mocked<AppLoggerService>;

  beforeEach(async () => {
    const mockLoggerService = {
      logFrontendEvent: jest.fn(),
      // #1079 部分受理時の棄却サマリ出力先
      warn: jest.fn(),
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

  /* ------------------------------------------------------------------ */
  /*   #1078 ビルド時メタ情報が欠落していてもログ本体を捨てない          */
  /* ------------------------------------------------------------------ */
  describe('#1078 created_commit_id / created_app_version の既定値補完', () => {
    const baseDto = {
      event_name: 'button_click',
      path_name: '/home',
      payload: { button: 'submit' },
      error_level: 'log' as const,
      created_at: '2024-01-01T00:00:00.000Z',
    };

    it('created_commit_id を欠いた dto は unknown-server で補完される', async () => {
      await service.createFrontendLog(
        { ...baseDto, created_app_version: '1.0.0' },
        'test-user-id',
      );

      const callArgs = mockLogger.logFrontendEvent.mock.calls[0][0];
      expect(callArgs.created_commit_id).toBe(UNKNOWN_BUILD_META_SERVER);
      expect(callArgs.created_app_version).toBe('1.0.0');
    });

    it('created_app_version を欠いた dto は unknown-server で補完される', async () => {
      await service.createFrontendLog(
        { ...baseDto, created_commit_id: 'abc123' },
        'test-user-id',
      );

      const callArgs = mockLogger.logFrontendEvent.mock.calls[0][0];
      expect(callArgs.created_app_version).toBe(UNKNOWN_BUILD_META_SERVER);
      expect(callArgs.created_commit_id).toBe('abc123');
    });

    it('空文字も欠落として扱う（?? ではなく || の担保）', async () => {
      await service.createFrontendLog(
        { ...baseDto, created_app_version: '', created_commit_id: '' },
        'test-user-id',
      );

      const callArgs = mockLogger.logFrontendEvent.mock.calls[0][0];
      expect(callArgs.created_app_version).toBe(UNKNOWN_BUILD_META_SERVER);
      expect(callArgs.created_commit_id).toBe(UNKNOWN_BUILD_META_SERVER);
    });

    it('値がある場合はそのまま透過する（production 無影響の回帰テスト）', async () => {
      await service.createFrontendLog(
        {
          ...baseDto,
          created_app_version: '3.1.0',
          created_commit_id: '0123456789abcdef0123456789abcdef01234567',
        },
        'test-user-id',
      );

      const callArgs = mockLogger.logFrontendEvent.mock.calls[0][0];
      expect(callArgs.created_app_version).toBe('3.1.0');
      expect(callArgs.created_commit_id).toBe(
        '0123456789abcdef0123456789abcdef01234567',
      );
    });

    it('バッチ経路でも同じ補完が効く（writeFrontendLog が共通の絞り）', async () => {
      await service.createFrontendLogBatch([{ ...baseDto }], 'test-user-id');

      const callArgs = mockLogger.logFrontendEvent.mock.calls[0][0];
      expect(callArgs.created_app_version).toBe(UNKNOWN_BUILD_META_SERVER);
      expect(callArgs.created_commit_id).toBe(UNKNOWN_BUILD_META_SERVER);
    });
  });

  /* ------------------------------------------------------------------ */
  /*   #1079 バッチの部分受理と棄却の可観測性                            */
  /* ------------------------------------------------------------------ */
  describe('createFrontendLogBatch', () => {
    const userId = 'test-user-id';

    const buildDto = (
      eventName: string,
      payload: Record<string, any> = {},
    ) => ({
      event_name: eventName,
      path_name: '/home',
      payload,
      error_level: 'log' as const,
      created_at: '2024-01-01T00:00:00.000Z',
      created_app_version: '1.0.0',
      created_commit_id: 'abc123',
    });

    const rejectedCommitId = (index: number): RejectedFrontendLogSummary => ({
      index,
      fields: ['created_commit_id'],
      constraints: ['isString'],
    });

    it('B1: 3 件受理・棄却 0 なら warn を出さない', async () => {
      const dtos = [buildDto('a'), buildDto('b'), buildDto('c')];

      const result = await service.createFrontendLogBatch(dtos, userId);

      expect(result).toEqual({ received: true, accepted: 3, rejected: 0 });
      expect(mockLogger.logFrontendEvent).toHaveBeenCalledTimes(3);
      expect(
        mockLogger.logFrontendEvent.mock.calls.map((c) => c[0].event_name),
      ).toEqual(['a', 'b', 'c']);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('B2: 受理 2・棄却 1 なら warn が 1 回、rejected_fields が集計される', async () => {
      const result = await service.createFrontendLogBatch(
        [buildDto('a'), buildDto('b')],
        userId,
        [rejectedCommitId(1)],
      );

      expect(result).toEqual({ received: true, accepted: 2, rejected: 1 });
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);

      const [eventName, functionName, payload] = mockLogger.warn.mock.calls[0];
      expect(eventName).toBe('frontend_log_batch_rejected');
      expect(functionName).toBe('LogsService.createFrontendLogBatch');
      expect(payload).toEqual({
        received: 3,
        accepted: 2,
        rejected: 1,
        rejected_fields: { created_commit_id: 1 },
        rejected_constraints: { isString: 1 },
        rejected_indices: [1],
      });
    });

    it('B3: 受理 0・棄却 5 なら書き込みは 0 回でも warn は出る', async () => {
      const rejected = Array.from({ length: 5 }, (_, i) => rejectedCommitId(i));

      const result = await service.createFrontendLogBatch([], userId, rejected);

      expect(result).toEqual({ received: true, accepted: 0, rejected: 5 });
      expect(mockLogger.logFrontendEvent).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    });

    it('B4: warn の引数にログ本文（PII）が含まれない', async () => {
      const sentinel = 'pii-sentinel@example.com';

      await service.createFrontendLogBatch(
        [buildDto('a', { email: sentinel })],
        userId,
        [rejectedCommitId(1)],
      );

      const serialized = JSON.stringify(mockLogger.warn.mock.calls[0]);
      expect(serialized).not.toContain(sentinel);
      expect(serialized).not.toContain('payload');
      expect(serialized).not.toContain('path_name');
    });

    it('B5: 棄却 50 件でも warn は 1 リクエスト 1 回', async () => {
      const rejected = Array.from({ length: 50 }, (_, i) =>
        rejectedCommitId(i),
      );

      await service.createFrontendLogBatch([buildDto('a')], userId, rejected);

      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn.mock.calls[0][2]).toMatchObject({
        rejected: 50,
        rejected_fields: { created_commit_id: 50 },
      });
    });

    it('B6: 2 件目の書き込みが失敗しても残りは書かれ received:true を返す', async () => {
      mockLogger.logFrontendEvent
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Log write failed'))
        .mockResolvedValueOnce(undefined);

      const result = await service.createFrontendLogBatch(
        [buildDto('a'), buildDto('b'), buildDto('c')],
        userId,
      );

      expect(result).toEqual({ received: true, accepted: 3, rejected: 0 });
      expect(mockLogger.logFrontendEvent).toHaveBeenCalledTimes(3);
    });

    it('B7: rejected 引数を省略しても既定 [] で動き warn を呼ばない（後方互換）', async () => {
      const result = await service.createFrontendLogBatch(
        [buildDto('a')],
        userId,
      );

      expect(result).toEqual({ received: true, accepted: 1, rejected: 0 });
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('B8: 複数のフィールド／制約が混在しても件数で集計される', async () => {
      await service.createFrontendLogBatch([], userId, [
        rejectedCommitId(0),
        rejectedCommitId(2),
        { index: 3, fields: ['(root)'], constraints: ['isObject'] },
      ]);

      expect(mockLogger.warn.mock.calls[0][2]).toMatchObject({
        rejected_fields: { created_commit_id: 2, '(root)': 1 },
        rejected_constraints: { isString: 2, isObject: 1 },
        rejected_indices: [0, 2, 3],
      });
    });
  });
});

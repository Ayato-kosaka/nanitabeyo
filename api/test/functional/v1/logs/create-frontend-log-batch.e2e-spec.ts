// api/test/functional/v1/logs/create-frontend-log-batch.e2e-spec.ts
//
// #1011 【設計】フロントログAPIのバッチ受け入れ対応（配列DTO）
// POST /v1/logs/frontend/batch の functional test。
// DB/GCS 等の外部依存を持たない Logs 関連モジュールのみを対象に、
// 実際の HTTP リクエスト経路（Guard→ValidationPipe→Controller→Service）を通して検証する。
//

// logger.service.ts が起動時に env スキーマを検証するため、import 前に最小限の値を設定する
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
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
// #1011 【設計】api/tsconfig.json は esModuleInterop 未設定のため、CJS export の supertest は名前空間 import で読み込む
import * as request from 'supertest';
import { LogsController } from '../../../../src/v1/logs/logs.controller';
import { LogsService } from '../../../../src/v1/logs/logs.service';
import { AppLoggerService } from '../../../../src/core/logger/logger.service';
import { AuthAnonGuard } from '../../../../src/core/auth/auth.guard';
import { REQ_USER_KEY } from '../../../../src/core/auth/auth.constants';

describe('Logs frontend batch endpoint (functional)', () => {
  let app: INestApplication;
  let loggerService: AppLoggerService;

  const testUserId = '00000000-0000-0000-0000-000000000001';

  // AuthAnonGuard は Supabase JWT 検証を要求するため、この functional test では
  // バッチ受け入れ処理の検証に専念できるよう認証済みユーザーへ差し替える
  class StubAuthAnonGuard implements CanActivate {
    canActivate(ctx: ExecutionContext): boolean {
      const req = ctx.switchToHttp().getRequest();
      req[REQ_USER_KEY] = {
        id: testUserId,
        isAnonymous: false,
        role: 'authenticated',
      };
      return true;
    }
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true })],
      controllers: [LogsController],
      providers: [LogsService, AppLoggerService],
    })
      .overrideGuard(AuthAnonGuard)
      .useValue(new StubAuthAnonGuard())
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    loggerService = moduleFixture.get(AppLoggerService);
  });

  afterAll(async () => {
    await app.close();
  });

  const buildLog = (eventName: string) => ({
    event_name: eventName,
    path_name: '/test',
    payload: { foo: 'bar' },
    error_level: 'log' as const,
    created_at: new Date().toISOString(),
    created_app_version: '1.0.0',
    created_commit_id: 'test-commit',
  });

  describe('POST /v1/logs/frontend/batch', () => {
    it('rejects an empty array', async () => {
      await request(app.getHttpServer())
        .post('/v1/logs/frontend/batch')
        .send({ logs: [] })
        .expect(400);
    });

    it('rejects an array exceeding the max size (100)', async () => {
      const logs = Array.from({ length: 101 }, (_, i) =>
        buildLog(`event_${i}`),
      );
      await request(app.getHttpServer())
        .post('/v1/logs/frontend/batch')
        .send({ logs })
        .expect(400);
    });

    // #1079 【設計】従来は 1 件の不正で最大 100 件が 400 になっていた（#1076 の増幅要因）。
    // 部分受理により、不正な要素だけを落として残りを受理する。
    it('accepts the valid items and drops only the invalid one', async () => {
      const spy = jest
        .spyOn(loggerService, 'logFrontendEvent')
        .mockResolvedValue(undefined);
      const warnSpy = jest
        .spyOn(loggerService, 'warn')
        .mockImplementation(() => undefined);

      const logs = [
        buildLog('valid_event'),
        { ...buildLog('invalid_event'), error_level: 'unknown' },
      ];
      const res = await request(app.getHttpServer())
        .post('/v1/logs/frontend/batch')
        .send({ logs })
        .expect(201);

      expect(res.body).toEqual({ received: true, accepted: 1, rejected: 1 });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toMatchObject({
        event_name: 'valid_event',
      });

      // #1079 棄却はバックエンドログへ 1 リクエスト 1 行だけ残る（ログ本文は含まない）
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toBe('frontend_log_batch_rejected');
      expect(warnSpy.mock.calls[0][2]).toMatchObject({
        received: 2,
        accepted: 1,
        rejected: 1,
        rejected_fields: { error_level: 1 },
      });

      spy.mockRestore();
      warnSpy.mockRestore();
    });

    // #1078 【設計】メタ情報 1 個の欠落でログ本体を捨てない（従来は 400 で全滅）
    it('accepts an item missing created_commit_id and fills the server-side default', async () => {
      const spy = jest
        .spyOn(loggerService, 'logFrontendEvent')
        .mockResolvedValue(undefined);

      const withoutCommitId: Record<string, unknown> = buildLog('no_commit_id');
      delete withoutCommitId.created_commit_id;

      const res = await request(app.getHttpServer())
        .post('/v1/logs/frontend/batch')
        .send({ logs: [buildLog('with_commit_id'), withoutCommitId] })
        .expect(201);

      expect(res.body).toEqual({ received: true, accepted: 2, rejected: 0 });
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls[1][0]).toMatchObject({
        event_name: 'no_commit_id',
        created_commit_id: 'unknown-server',
      });

      spy.mockRestore();
    });

    // #1079 指摘1 の回帰: route-scoped pipe は handler の全パラメータ（@CurrentUser() を含む）
    // に適用される。metadata.type のガードが無いと正常リクエストでも常に 400 になる。
    it('does not validate non-body parameters (regression for route-scoped pipe)', async () => {
      const spy = jest
        .spyOn(loggerService, 'logFrontendEvent')
        .mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/v1/logs/frontend/batch')
        .send({ logs: [buildLog('current_user_param')] })
        .expect(201);

      expect(res.body).toEqual({ received: true, accepted: 1, rejected: 0 });
      // @CurrentUser() が素通しされ、user.id が Service まで届いていること
      expect(spy.mock.calls[0][0]).toMatchObject({ user_id: testUserId });

      spy.mockRestore();
    });

    it('drops non-object items without failing the whole batch', async () => {
      const spy = jest
        .spyOn(loggerService, 'logFrontendEvent')
        .mockResolvedValue(undefined);
      const warnSpy = jest
        .spyOn(loggerService, 'warn')
        .mockImplementation(() => undefined);

      const res = await request(app.getHttpServer())
        .post('/v1/logs/frontend/batch')
        .send({ logs: [buildLog('ok'), null, 'x', []] })
        .expect(201);

      expect(res.body).toEqual({ received: true, accepted: 1, rejected: 3 });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][2]).toMatchObject({
        rejected_constraints: { isObject: 3 },
      });

      spy.mockRestore();
      warnSpy.mockRestore();
    });

    it('records the same content as individual single-log calls', async () => {
      const spy = jest
        .spyOn(loggerService, 'logFrontendEvent')
        .mockResolvedValue(undefined);

      const logs = [
        buildLog('event_a'),
        buildLog('event_b'),
        buildLog('event_c'),
      ];

      const res = await request(app.getHttpServer())
        .post('/v1/logs/frontend/batch')
        .send({ logs })
        .expect(201);

      // #1079 レスポンスに accepted / rejected が加わる（received: true は不変）
      expect(res.body).toEqual({
        received: true,
        accepted: logs.length,
        rejected: 0,
      });
      expect(spy).toHaveBeenCalledTimes(logs.length);
      logs.forEach((log, i) => {
        expect(spy.mock.calls[i][0]).toMatchObject({
          user_id: testUserId,
          event_name: log.event_name,
          path_name: log.path_name,
          payload: log.payload,
          error_level: log.error_level,
          created_at: log.created_at,
          created_app_version: log.created_app_version,
          created_commit_id: log.created_commit_id,
        });
      });

      spy.mockRestore();
    });
  });

  describe('POST /v1/logs/frontend (regression)', () => {
    it('still accepts a single log unchanged', async () => {
      const spy = jest
        .spyOn(loggerService, 'logFrontendEvent')
        .mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/v1/logs/frontend')
        .send(buildLog('single_event'))
        .expect(201);

      expect(res.body).toEqual({ received: true });
      expect(spy).toHaveBeenCalledTimes(1);

      spy.mockRestore();
    });
  });
});

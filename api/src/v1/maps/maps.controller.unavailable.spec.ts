// api/src/v1/maps/maps.controller.unavailable.spec.ts
//
// #843 GOOGLE_MAPS_EMBED_API_KEY 未設定時の縮退（503）を固定する。
// オーナーが GCP で Maps Embed API を有効化しキーを設定するまでは、
// このエンドポイントは 503 を返し続け、クライアント側は既存の外部ブラウザ遷移へ縮退する。
//
// #1810 PL レビュー: POST /v1/maps/embed-token にも同じ縮退（503）が要る。
// トークンを発行しても使い道が無い（GET 側がどのみち 503 になる）ため、
// 発行そのものを先に止める。ただし AuthAnonGuard は key の有無に関係なく効く
// （認証なしでは 503 の中身すら見せない）。
//
// ⚠️ 「キー設定済み」の検証（400 / 200 系）は maps.controller.spec.ts 側に置いてある。
//    同じファイルで env のモック値を出し分けると衝突しやすいため、ファイルごと分けている。

jest.mock('../../core/config/env', () => ({
  env: new Proxy(
    {},
    {
      get: (_target, key: string) =>
        key === 'GOOGLE_MAPS_EMBED_API_KEY' ? undefined : `test-${key}`,
    },
  ),
}));

import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Global,
  INestApplication,
  Module,
  VersioningType,
} from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ClsService } from 'nestjs-cls';
import request = require('supertest');

import { MapsModule } from './maps.module';
import { SupabaseJwtStrategy } from '../../core/auth/jwt.strategy';
import { AppLoggerService } from '../../core/logger/logger.service';
import { signMapsEmbedToken } from './maps-embed.token';

// #1810: MapsModule 単体テストでも本番同様に AuthAnonGuard が解決できるよう、
// @Global() の AuthModule 相当を最小構成で用意する（詳細は maps.controller.spec.ts 参照）。
const SUPABASE_JWT_SECRET = 'test-SUPABASE_JWT_SECRET';

@Global()
@Module({
  imports: [PassportModule],
  providers: [
    SupabaseJwtStrategy,
    { provide: ClsService, useValue: { set: jest.fn(), get: jest.fn() } },
    {
      provide: AppLoggerService,
      useValue: {
        debug: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        externalApi: jest.fn(),
      },
    },
  ],
  exports: [SupabaseJwtStrategy, ClsService, AppLoggerService],
})
class TestAuthSupportModule {}

function mintTestJwt(payload: Record<string, unknown>, secret: string): string {
  const base64url = (input: string) =>
    Buffer.from(input, 'utf8').toString('base64url');
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function validAuthHeader(): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const jwt = mintTestJwt(
    {
      sub: 'test-user-id',
      is_anonymous: true,
      iat: nowSec,
      exp: nowSec + 3600,
    },
    SUPABASE_JWT_SECRET,
  );
  return `Bearer ${jwt}`;
}

describe('MapsController（キー未設定）', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAuthSupportModule, MapsModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /v1/maps/embed-token', () => {
    it('Authorization ヘッダが無ければ、キーの有無に関係なく 401（ガードが先に効く）', async () => {
      await request(app.getHttpServer())
        .post('/v1/maps/embed-token')
        .send({ mode: 'search', q: 'ramen' })
        .expect(401);
    });

    it('認証済みでもキーが無ければ 503', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/maps/embed-token')
        .set('Authorization', validAuthHeader())
        .send({ mode: 'search', q: 'ramen' })
        .expect(503);

      // JSON のエラーレスポンスにキーは含まれない（そもそも読んでいない）
      expect(JSON.stringify(res.body)).not.toContain(
        'GOOGLE_MAPS_EMBED_API_KEY',
      );
    });

    it('バリデーションエラー（mode 不正）は 503 より先に 400 になる', async () => {
      await request(app.getHttpServer())
        .post('/v1/maps/embed-token')
        .set('Authorization', validAuthHeader())
        .send({ mode: 'bogus', q: 'ramen' })
        .expect(400);
    });
  });

  describe('GET /v1/maps/embed', () => {
    it('token が正しい形でも 503 を返す（バリデーションより先に落ちない）', async () => {
      const token = signMapsEmbedToken(
        { mode: 'search', q: 'ramen' },
        SUPABASE_JWT_SECRET,
        Date.now(),
      );

      const res = await request(app.getHttpServer())
        .get('/v1/maps/embed')
        .query({ token })
        .expect(503);

      expect(JSON.stringify(res.body)).not.toContain(
        'GOOGLE_MAPS_EMBED_API_KEY',
      );
    });

    it('token クエリが無ければ 503 より先に 400 になる', async () => {
      await request(app.getHttpServer()).get('/v1/maps/embed').expect(400);
    });
  });
});

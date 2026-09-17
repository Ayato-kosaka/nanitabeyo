// api/src/v1/maps/maps.controller.spec.ts
//
// #1810 PL レビュー: GET /v1/maps/embed の HTTP レベルの検証（キー設定済み）。
// - POST /v1/maps/embed-token には AuthAnonGuard が付いている（メタデータ + 実際に 401 になること）
// - POST が発行したトークンの署名・payload が正しいこと
// - GET は token の検証（無し・不正な署名・期限切れ → 拒否、正しければ 200）
// - q のエスケープ・キーの露出範囲は #843 からの既存確認を維持

// core/config/env は import 時に process.env をバリデーションして throw するため、
// 実DB・実APIに触れない単体テストでも .env が無いと suite ごと落ちる。
jest.mock('../../core/config/env', () => ({
  env: new Proxy(
    {},
    {
      get: (_target, key: string) =>
        key === 'GOOGLE_MAPS_EMBED_API_KEY' ? 'test-embed-key' : `test-${key}`,
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
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PassportModule } from '@nestjs/passport';
import { ClsService } from 'nestjs-cls';
import request = require('supertest');

import { MapsModule } from './maps.module';
import { MapsController } from './maps.controller';
import { AuthAnonGuard } from '../../core/auth/auth.guard';
import { SupabaseJwtStrategy } from '../../core/auth/jwt.strategy';
import { AppLoggerService } from '../../core/logger/logger.service';
import {
  signMapsEmbedToken,
  verifyMapsEmbedToken,
  MAPS_EMBED_TOKEN_TTL_MS,
} from './maps-embed.token';

// 本番では @Global() の AuthModule（api/src/core/auth/auth.module.ts）が
// SupabaseJwtStrategy 等をどのモジュールからも見えるようにしている。
// MapsModule 単体をテストするとその恩恵が無いため、同じ形（@Global）の
// 最小構成をここで用意する（StaticMasterModule 等の重い依存は持ち込まない）。
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

// env モックと同じ値（jwt.strategy.ts の secretOrKey / controller の署名鍵の両方がこれを参照する）
const SUPABASE_JWT_SECRET = 'test-SUPABASE_JWT_SECRET';

/** passport-jwt が検証できる最小限の HS256 JWT を自前で組み立てる（jsonwebtoken を追加依存させない） */
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

describe('MapsController（キー設定済み）', () => {
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

  describe('AuthAnonGuard が付いていること（メタデータ）', () => {
    // #1810 PL レビュー: 「ガードを外すと赤くなる」を、DI が重い HTTP 経路とは別に
    // 軽量にも固定しておく。@UseGuards(AuthAnonGuard) を外すとこの 2 件が最初に赤くなる。
    it('POST /v1/maps/embed-token には AuthAnonGuard が付いている', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        MapsController.prototype.createEmbedToken,
      );
      expect(guards).toContain(AuthAnonGuard);
    });

    it('GET /v1/maps/embed にはガードを付けない（WebView が Authorization を送れないため設計どおり）', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        MapsController.prototype.getEmbed,
      );
      expect(guards ?? []).not.toContain(AuthAnonGuard);
    });
  });

  describe('POST /v1/maps/embed-token', () => {
    it('Authorization ヘッダが無ければ 401', async () => {
      await request(app.getHttpServer())
        .post('/v1/maps/embed-token')
        .send({ mode: 'search', q: 'ramen' })
        .expect(401);
    });

    it('mode が search/place 以外なら 400', async () => {
      await request(app.getHttpServer())
        .post('/v1/maps/embed-token')
        .set('Authorization', validAuthHeader())
        .send({ mode: 'bogus', q: 'ramen' })
        .expect(400);
    });

    it('q が無ければ 400', async () => {
      await request(app.getHttpServer())
        .post('/v1/maps/embed-token')
        .set('Authorization', validAuthHeader())
        .send({ mode: 'search' })
        .expect(400);
    });

    it('正常系: token と expiresAt を返し、token は自分自身の署名鍵で検証できる', async () => {
      const before = Date.now();
      const res = await request(app.getHttpServer())
        .post('/v1/maps/embed-token')
        .set('Authorization', validAuthHeader())
        .send({
          mode: 'search',
          q: 'ラーメン 渋谷',
          center: '35.6,139.7',
          zoom: 15,
          hl: 'ja',
        })
        .expect(201);

      expect(typeof res.body.token).toBe('string');
      expect(typeof res.body.expiresAt).toBe('string');

      const verified = verifyMapsEmbedToken(
        res.body.token,
        SUPABASE_JWT_SECRET,
        Date.now(),
      );
      expect(verified).toEqual({
        mode: 'search',
        q: 'ラーメン 渋谷',
        center: '35.6,139.7',
        zoom: 15,
        hl: 'ja',
      });

      const expiresAt = new Date(res.body.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(
        before + MAPS_EMBED_TOKEN_TTL_MS,
      );
      expect(expiresAt).toBeLessThanOrEqual(
        Date.now() + MAPS_EMBED_TOKEN_TTL_MS,
      );
    });
  });

  describe('GET /v1/maps/embed', () => {
    it('token クエリが無ければ 400', async () => {
      await request(app.getHttpServer()).get('/v1/maps/embed').expect(400);
    });

    it('署名が壊れた token は 401', async () => {
      const token = signMapsEmbedToken(
        { mode: 'search', q: 'ramen' },
        SUPABASE_JWT_SECRET,
        Date.now(),
      );
      const tampered = `${token}x`;

      await request(app.getHttpServer())
        .get('/v1/maps/embed')
        .query({ token: tampered })
        .expect(401);
    });

    it('期限切れの token は 401', async () => {
      const issuedInThePast = Date.now() - MAPS_EMBED_TOKEN_TTL_MS - 1_000;
      const expiredToken = signMapsEmbedToken(
        { mode: 'search', q: 'ramen' },
        SUPABASE_JWT_SECRET,
        issuedInThePast,
      );

      await request(app.getHttpServer())
        .get('/v1/maps/embed')
        .query({ token: expiredToken })
        .expect(401);
    });

    it('正常系: 200 / text/html で iframe を含む HTML を返す', async () => {
      const token = signMapsEmbedToken(
        {
          mode: 'search',
          q: 'ラーメン 渋谷',
          center: '35.6,139.7',
          zoom: 15,
          hl: 'ja',
        },
        SUPABASE_JWT_SECRET,
        Date.now(),
      );

      const res = await request(app.getHttpServer())
        .get('/v1/maps/embed')
        .query({ token })
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['cache-control']).toBe('private, max-age=300');
      expect(res.text).toContain('<iframe');
      expect(res.text).toContain('maps/embed/v1/search');
    });

    it('place モード: q=place_id:<id> をそのまま Embed API へ渡す', async () => {
      const token = signMapsEmbedToken(
        { mode: 'place', q: 'place_id:ChIJplace1' },
        SUPABASE_JWT_SECRET,
        Date.now(),
      );

      const res = await request(app.getHttpServer())
        .get('/v1/maps/embed')
        .query({ token })
        .expect(200);

      expect(res.text).toContain('maps/embed/v1/place');
      expect(res.text).toContain(encodeURIComponent('place_id:ChIJplace1'));
    });

    it('キーはレスポンス本文の iframe src 以外に現れない', async () => {
      const token = signMapsEmbedToken(
        { mode: 'search', q: 'ramen' },
        SUPABASE_JWT_SECRET,
        Date.now(),
      );

      const res = await request(app.getHttpServer())
        .get('/v1/maps/embed')
        .query({ token })
        .expect(200);

      const occurrences = res.text.split('test-embed-key').length - 1;
      expect(occurrences).toBe(1);
      expect(res.text).toMatch(/<iframe src="[^"]*test-embed-key[^"]*"/);
    });

    it('q に混ぜた script タグは本文へそのまま出ない（400 にならず、かつ非エスケープで残らない）', async () => {
      const token = signMapsEmbedToken(
        { mode: 'search', q: `"><script>alert(1)</script>` },
        SUPABASE_JWT_SECRET,
        Date.now(),
      );

      const res = await request(app.getHttpServer())
        .get('/v1/maps/embed')
        .query({ token })
        .expect(200);

      expect(res.text).not.toContain('<script>alert(1)</script>');
    });
  });
});

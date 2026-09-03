// api/src/v1/maps/maps.controller.unavailable.spec.ts
//
// #843 GOOGLE_MAPS_EMBED_API_KEY 未設定時の縮退（503）を固定する。
// オーナーが GCP で Maps Embed API を有効化しキーを設定するまでは、
// このエンドポイントは 503 を返し続け、クライアント側は既存の外部ブラウザ遷移へ縮退する。
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
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import request = require('supertest');
import { MapsModule } from './maps.module';

describe('MapsController（キー未設定）', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [MapsModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('クエリが正しくても 503 を返す（バリデーションより先に落ちない）', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/maps/embed')
      .query({ mode: 'search', q: 'ramen' })
      .expect(503);

    // JSON のエラーレスポンスにキーは含まれない（そもそも読んでいない）
    expect(JSON.stringify(res.body)).not.toContain('GOOGLE_MAPS_EMBED_API_KEY');
  });

  it('バリデーションエラー（mode 不正）は 503 より先に 400 になる', async () => {
    await request(app.getHttpServer())
      .get('/v1/maps/embed')
      .query({ mode: 'bogus', q: 'ramen' })
      .expect(400);
  });
});

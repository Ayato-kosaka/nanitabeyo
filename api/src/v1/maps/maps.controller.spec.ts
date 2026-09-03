// api/src/v1/maps/maps.controller.spec.ts
//
// #843 GET /v1/maps/embed の HTTP レベルの検証（キー設定済み）。
// - mode の検証（不正値 → 400）
// - q 必須（未指定 → 400）
// - 正常系は 200 / text/html で、q のエスケープ・キーの露出範囲を確かめる

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
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import request = require('supertest');
import { MapsModule } from './maps.module';

describe('MapsController（キー設定済み）', () => {
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

  it('mode が search/place 以外なら 400', async () => {
    await request(app.getHttpServer())
      .get('/v1/maps/embed')
      .query({ mode: 'bogus', q: 'ramen' })
      .expect(400);
  });

  it('q が無ければ 400', async () => {
    await request(app.getHttpServer())
      .get('/v1/maps/embed')
      .query({ mode: 'search' })
      .expect(400);
  });

  it('mode 自体が無ければ 400', async () => {
    await request(app.getHttpServer())
      .get('/v1/maps/embed')
      .query({ q: 'ramen' })
      .expect(400);
  });

  it('正常系: 200 / text/html で iframe を含む HTML を返す', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/maps/embed')
      .query({ mode: 'search', q: 'ラーメン 渋谷', center: '35.6,139.7', zoom: 15, hl: 'ja' })
      .expect(200);

    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<iframe');
    expect(res.text).toContain('maps/embed/v1/search');
  });

  it('place モード: q=place_id:<id> をそのまま Embed API へ渡す', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/maps/embed')
      .query({ mode: 'place', q: 'place_id:ChIJplace1' })
      .expect(200);

    expect(res.text).toContain('maps/embed/v1/place');
    expect(res.text).toContain(encodeURIComponent('place_id:ChIJplace1'));
  });

  it('キーはレスポンス本文の iframe src 以外に現れない', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/maps/embed')
      .query({ mode: 'search', q: 'ramen' })
      .expect(200);

    const occurrences = res.text.split('test-embed-key').length - 1;
    expect(occurrences).toBe(1);
    expect(res.text).toMatch(/<iframe src="[^"]*test-embed-key[^"]*"/);
  });

  it('q に混ぜた script タグは本文へそのまま出ない（400 にならず、かつ非エスケープで残らない）', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/maps/embed')
      .query({ mode: 'search', q: `"><script>alert(1)</script>` })
      .expect(200);

    expect(res.text).not.toContain('<script>alert(1)</script>');
  });
});

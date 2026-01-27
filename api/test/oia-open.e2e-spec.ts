// api/test/oia-open.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('OIA Open Relay (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /oia/open', () => {
    it('正常系: 有効な app.nanitabeyo.net URL で 302 リダイレクト', async () => {
      const targetUrl = 'https://app.nanitabeyo.net/ja-JP/posts?ids=xxx';
      const encodedUrl = encodeURIComponent(targetUrl);

      const response = await request(app.getHttpServer())
        .get(`/oia/open?u=${encodedUrl}`)
        .expect(302);

      expect(response.headers['location']).toBe(targetUrl);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
    });

    it('正常系: パス付きの app.nanitabeyo.net URL で 302 リダイレクト', async () => {
      const targetUrl = 'https://app.nanitabeyo.net/en-US/profile';
      const encodedUrl = encodeURIComponent(targetUrl);

      const response = await request(app.getHttpServer())
        .get(`/oia/open?u=${encodedUrl}`)
        .expect(302);

      expect(response.headers['location']).toBe(targetUrl);
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('異常系: u パラメータなしで 400 Bad Request', async () => {
      await request(app.getHttpServer()).get('/oia/open').expect(400);
    });

    it('異常系: 空文字の u パラメータで 400 Bad Request', async () => {
      await request(app.getHttpServer()).get('/oia/open?u=').expect(400);
    });

    it('異常系: 不正な URL フォーマットで 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .get('/oia/open?u=invalid-url')
        .expect(400);
    });

    it('異常系: http プロトコルで 403 Forbidden', async () => {
      const targetUrl = 'http://app.nanitabeyo.net/ja-JP/posts';
      const encodedUrl = encodeURIComponent(targetUrl);

      await request(app.getHttpServer())
        .get(`/oia/open?u=${encodedUrl}`)
        .expect(403);
    });

    it('異常系: 許可されていないホストで 403 Forbidden', async () => {
      const targetUrl = 'https://evil.example.com/phishing';
      const encodedUrl = encodeURIComponent(targetUrl);

      await request(app.getHttpServer())
        .get(`/oia/open?u=${encodedUrl}`)
        .expect(403);
    });

    it('異常系: URL が長すぎる場合 400 Bad Request', async () => {
      // 2048文字を超える URL を生成
      const longPath = 'a'.repeat(2100);
      const targetUrl = `https://app.nanitabeyo.net/${longPath}`;
      const encodedUrl = encodeURIComponent(targetUrl);

      await request(app.getHttpServer())
        .get(`/oia/open?u=${encodedUrl}`)
        .expect(400);
    });
  });
});

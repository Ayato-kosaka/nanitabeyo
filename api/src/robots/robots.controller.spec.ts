import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import request = require('supertest');
import { RobotsController, ROBOTS_TXT_BODY } from './robots.controller';
import { RobotsModule } from './robots.module';
import { SKIP_WRAP_META_KEY } from '../core/interceptors/response-wrap.interceptor';

describe('RobotsController', () => {
  describe('unit', () => {
    let controller: RobotsController;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [RobotsController],
      }).compile();

      controller = module.get<RobotsController>(RobotsController);
    });

    it('全クローラを拒否する本文を返す', () => {
      expect(controller.getRobotsTxt()).toBe('User-agent: *\nDisallow: /\n');
    });

    it('ResponseWrapInterceptor の対象外に設定されている（プレーンテキストのまま返すため）', () => {
      const skip = Reflect.getMetadata(
        SKIP_WRAP_META_KEY,
        controller.getRobotsTxt,
      );
      expect(skip).toBe(true);
    });
  });

  // main.ts の app.enableVersioning() を再現した上で HTTP 経由の挙動を固定する。
  // RobotsController は version を指定していないため、AppController(`/`) や
  // HealthController(`/health`) と同様に /v1 等の prefix なしで登録される想定。
  // この前提が崩れて /robots.txt が引けなくなった場合にここが赤くなる。
  describe('HTTP', () => {
    let app: INestApplication;

    beforeEach(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [RobotsModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      app.enableVersioning({ type: VersioningType.URI });
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    it('GET /robots.txt が 200 で期待どおりの本文・ヘッダを返す', async () => {
      const res = await request(app.getHttpServer())
        .get('/robots.txt')
        .expect(200);

      expect(res.text).toBe(ROBOTS_TXT_BODY);
      expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(res.headers['cache-control']).toBe(
        'public, max-age=86400, immutable',
      );
    });

    it('バージョン prefix 付きの /v1/robots.txt では引けない（無 prefix 登録であることの確認）', async () => {
      await request(app.getHttpServer()).get('/v1/robots.txt').expect(404);
    });

    it('存在しないパスは従来どおり 404', async () => {
      await request(app.getHttpServer()).get('/no-such-path').expect(404);
    });
  });
});

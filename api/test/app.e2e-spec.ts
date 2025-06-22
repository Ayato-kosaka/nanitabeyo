import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/v1/hello (GET)', () => {
    return request(app.getHttpServer())
      .get('/v1/hello')
      .expect(200)
      .expect('Hello from v1');
  });

  it('/v2/hello (GET)', () => {
    return request(app.getHttpServer())
      .get('/v2/hello')
      .expect(200)
      .expect('Hello from v2');
  });

  it('/v1/dish-media without required params (GET)', () => {
    return request(app.getHttpServer())
      .get('/v1/dish-media')
      .expect(400);
  });
});

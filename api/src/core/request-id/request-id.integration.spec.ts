import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import * as request from 'supertest';
import { RequestIdModule } from './request-id.module';
import { Controller, Get } from '@nestjs/common';
import { CLS_KEY_REQUEST_ID } from '../cls/cls.constants';
import { REQUEST_ID_HEADER } from './request-id.constants';
import { ResponseWrapInterceptor } from '../interceptors/response-wrap.interceptor';
import { Reflector } from '@nestjs/core';

@Controller('test')
class TestController {
  constructor(private readonly cls: ClsService) {}

  @Get()
  getTest(): { requestId: string | undefined } {
    return {
      requestId: this.cls.get<string>(CLS_KEY_REQUEST_ID),
    };
  }
}

describe('Request ID Integration', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RequestIdModule],
      controllers: [TestController],
    }).compile();

    app = moduleRef.createNestApplication();

    // Add the response wrap interceptor to test header setting
    app.useGlobalInterceptors(
      new ResponseWrapInterceptor(app.get(ClsService), app.get(Reflector)),
    );

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should generate and include request ID in response headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/test')
      .expect(200);

    // Check that response includes request ID header
    expect(response.headers[REQUEST_ID_HEADER.toLowerCase()]).toBeDefined();
    expect(response.headers[REQUEST_ID_HEADER.toLowerCase()]).toMatch(
      /^[0-9a-f-]{36}$/,
    ); // UUID format

    // Check that the request ID is available in the response body
    expect(response.body.data.requestId).toBeDefined();
    expect(response.body.data.requestId).toBe(
      response.headers[REQUEST_ID_HEADER.toLowerCase()],
    );
  });

  it('should use provided request ID from header', async () => {
    const providedRequestId = 'custom-request-id-123';

    const response = await request(app.getHttpServer())
      .get('/test')
      .set(REQUEST_ID_HEADER, providedRequestId)
      .expect(200);

    // Check that the provided request ID is used
    expect(response.headers[REQUEST_ID_HEADER.toLowerCase()]).toBe(
      providedRequestId,
    );
    expect(response.body.data.requestId).toBe(providedRequestId);
  });
});

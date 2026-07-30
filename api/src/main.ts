import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import { env } from './core/config/env';
import { ApiExceptionFilter } from './core/filters/api-exception.filter';
import { ClsService } from 'nestjs-cls';
import { AppLoggerService } from './core/logger/logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ★ 計測ミドルウェア（最上流）
  app.use((req: any, _res, next) => {
    const now = Date.now();
    req._t0 = now; // ヘッダ受信時刻
    // リクエストボディを受信し終わった時点（body-parser 前でも 'end' は発火する）
    req.on('end', () => {
      req._tBodyEnd = Date.now();
    });
    next();
  });

  app.enableVersioning({
    type: VersioningType.URI,
  });

  app.enableCors({
    // CORS_ORIGIN はカンマ区切りで複数指定可能（env.ts で string[] に変換済み）
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // #1052 x-app-language は非 safelisted ヘッダなので、許可リストへ足さないと
    // web 版の preflight がすべて拒否され、認証済み API 呼び出しが一律失敗する。
    // fetchWithAuth が全リクエストへ付けるため、漏れると影響範囲が全画面になる。
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-app-version',
      'x-app-language',
    ],
    exposedHeaders: ['x-request-id', 'x-cloud-trace-context'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true, // plain→class 変換を有効に
      transformOptions: {
        // ★ ここがポイント
        enableImplicitConversion: true, // "50" → 50
      },
      whitelist: true,
      forbidUnknownValues: false,
    }),
  );

  app.useGlobalFilters(
    new ApiExceptionFilter(app.get(ClsService), app.get(AppLoggerService)),
  );

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

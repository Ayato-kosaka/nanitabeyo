import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import { env } from './core/config/env';
import { ApiExceptionFilter } from './core/filters/api-exception.filter';
import { ClsService } from 'nestjs-cls';
import { ResponseWrapInterceptor } from './core/interceptors/response-wrap.interceptor';
import { AppLoggerService } from './core/logger/logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableVersioning({
    type: VersioningType.URI,
  });

  app.enableCors({
    origin: env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-app-version'],
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

  app.useGlobalInterceptors(
    new ResponseWrapInterceptor(
      app.get(ClsService),
      app.get(Reflector),
      app.get(AppLoggerService),
    ),
  );

  app.useGlobalFilters(
    new ApiExceptionFilter(app.get(ClsService), app.get(AppLoggerService)),
  );

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

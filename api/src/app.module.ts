import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { LoggerModule } from './core/logger/logger.module';
import { RequestIdModule } from './core/request-id/request-id.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { V1Module } from './v1/v1.module';
import { V2Module } from './v2/v2.module';

@Module({
  imports: [
    RequestIdModule, // This configures CLS globally with proper middleware
    PrismaModule,
    LoggerModule,
    V1Module,
    V2Module,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

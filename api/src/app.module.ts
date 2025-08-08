import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { PrismaModule } from './prisma/prisma.module';
import { LoggerModule } from './core/logger/logger.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { V1Module } from './v1/v1.module';
import { V2Module } from './v2/v2.module';

@Module({
  imports: [
    ClsModule.forRoot({
      // CLSの設定...
    }),
    PrismaModule,
    LoggerModule,
    V1Module,
    V2Module,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }

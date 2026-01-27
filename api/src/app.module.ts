import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { LoggerModule } from './core/logger/logger.module';
import { RequestIdModule } from './core/request-id/request-id.module';
import { RemoteConfigModule } from './core/remote-config/remote-config.module';
import { MaintenanceGuard } from './core/guards/maintenance.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { V1Module } from './v1/v1.module';
import { V2Module } from './v2/v2.module';
import { InternalModule } from './internal/internal.module';
import { ToolsModule } from './tools/tools.module';
import { HealthModule } from './health/health.module';
import { OiaModule } from './oia/oia.module';
import { ResponseWrapInterceptor } from './core/interceptors/response-wrap.interceptor';
import { CoreModule } from './core/core.module';

@Module({
  imports: [
    RequestIdModule, // This configures CLS globally with proper middleware
    PrismaModule,
    LoggerModule,
    RemoteConfigModule, // Add RemoteConfigModule for MaintenanceGuard
    V1Module,
    V2Module,
    InternalModule, // Internal endpoints for Cloud Tasks
    ToolsModule, // Tools endpoints for admin use
    HealthModule, // Add HealthModule
    OiaModule, // #713 OIA Relay for Universal Link stabilization
    CoreModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    ResponseWrapInterceptor,
    // Register MaintenanceGuard globally
    {
      provide: APP_GUARD,
      useClass: MaintenanceGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseWrapInterceptor,
    },
  ],
})
export class AppModule {}

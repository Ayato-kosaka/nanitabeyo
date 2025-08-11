// api/src/internal/bulk-import/bulk-import.module.ts
//
// 内部処理用モジュール
//

import { Module } from '@nestjs/common';
import { BulkImportController } from './bulk-import.controller';
import { BulkImportExecutorService } from './bulk-import-executor.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CoreModule } from '../../core/core.module';
import { LocationsModule } from '../../v1/locations/locations.module';

@Module({
  imports: [PrismaModule, CoreModule, LocationsModule],
  controllers: [BulkImportController],
  providers: [BulkImportExecutorService],
})
export class BulkImportModule {}

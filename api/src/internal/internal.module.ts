// api/src/internal/internal.module.ts
//
// 内部エンドポイント全体をまとめるモジュール
//

import { Module } from '@nestjs/common';
import { BulkImportModule } from './bulk-import/bulk-import.module';

@Module({
  imports: [BulkImportModule],
})
export class InternalModule {}
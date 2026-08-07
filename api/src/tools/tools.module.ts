// api/src/tools/tools.module.ts
//
// Module for tools endpoints (admin/internal use)
// #494 【設計】運営用ツール
//

import { Module } from '@nestjs/common';
import { ToolsDishCategoriesModule } from './dish-categories/tools-dish-categories.module';

@Module({
  imports: [ToolsDishCategoriesModule],
})
export class ToolsModule {}

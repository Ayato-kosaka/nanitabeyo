// api/src/internal/internal.module.ts
//
// 内部エンドポイント全体をまとめるモジュール
//

import { Module } from '@nestjs/common';
import { InternalDishesModule } from './dishes/dishes.module';

@Module({
  imports: [InternalDishesModule],
})
export class InternalModule {}

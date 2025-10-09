// api/src/internal/internal.module.ts
//
// 内部エンドポイント全体をまとめるモジュール
//

import { Module } from '@nestjs/common';
import { InternalDishesModule } from './dishes/dishes.module';
import { ResizeImageModule } from './resize-image/resize-image.module';

@Module({
  imports: [InternalDishesModule, ResizeImageModule],
})
export class InternalModule {}

// api/src/internal/internal.module.ts
//
// 内部エンドポイント全体をまとめるモジュール
//

import { Module } from '@nestjs/common';
import { InternalDishesModule } from './dishes/dishes.module';
import { ResizeImageModule } from './resize-image/resize-image.module';
import { TranscodeModule } from './transcode/transcode.module';

@Module({
  imports: [InternalDishesModule, ResizeImageModule, TranscodeModule],
})
export class InternalModule {}

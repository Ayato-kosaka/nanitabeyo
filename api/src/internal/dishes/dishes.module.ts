// api/src/internal/dishes/dishes.module.ts
//
// 内部処理用モジュール
//

import { Module } from '@nestjs/common';
import { DishesController } from './dishes.controller';
import { CreateDishMediaEntryService } from './create-dish-media-entry.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CoreModule } from '../../core/core.module';
import { DishesModule as V1DishesModule } from '../../v1/dishes/dishes.module';

@Module({
  imports: [PrismaModule, CoreModule, V1DishesModule],
  controllers: [DishesController],
  providers: [CreateDishMediaEntryService],
})
export class InternalDishesModule { }

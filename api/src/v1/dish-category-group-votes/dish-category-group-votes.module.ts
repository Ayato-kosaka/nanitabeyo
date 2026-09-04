// api/src/v1/dish-category-group-votes/dish-category-group-votes.module.ts
//
// #856 【設計】dish_category グループ投票機能の DI 設定。
// Controller / Service / Repository / Assembler を分離し、
// 既存 v1 モジュールと同じく横串インフラは Module imports で明示する。

import { Module } from '@nestjs/common';
import { DishCategoryGroupVotesController } from './dish-category-group-votes.controller';
import { DishCategoryGroupVotesService } from './dish-category-group-votes.service';
import { DishCategoryGroupVotesRepository } from './dish-category-group-votes.repository';
import { DishCategoryGroupVotesAssembler } from './dish-category-group-votes.assembler';

import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module';
import { CloudTasksModule } from '../../core/cloud-tasks/cloud-tasks.module';

@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    AuthModule,
    CloudTasksModule, // Cloud Tasks サービス
  ],
  controllers: [DishCategoryGroupVotesController],
  providers: [
    DishCategoryGroupVotesService,
    DishCategoryGroupVotesRepository,
    DishCategoryGroupVotesAssembler,
  ],
  exports: [DishCategoryGroupVotesService, DishCategoryGroupVotesRepository],
})
export class DishCategoryGroupVotesModule {}

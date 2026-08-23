// api/src/v1/dish-media-imports/dish-media-imports.module.ts
//
// #1399 SNS URL Import（解決のみ。保存は Blocker B-1 の判断待ちでスコープ外）

import { Module, forwardRef } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module';
import { SafeFetchModule } from '../../core/safe-fetch/safe-fetch.module';
import { StorageModule } from '../../core/storage/storage.module';
import { CloudTasksModule } from '../../core/cloud-tasks/cloud-tasks.module';
import { DishCategoriesModule } from '../dish-categories/dish-categories.module';
import { DishCategoryVariantsModule } from '../dish-category-variants/dish-category-variants.module';
import { RestaurantsModule } from '../restaurants/restaurants.module';

import { DishCategoryVariantDictionaryService } from './dish-category-variant-dictionary.service';
import { DishMediaImportsController } from './dish-media-imports.controller';
import { DishMediaImportsService } from './dish-media-imports.service';
import { SnsOembedService } from './sns-oembed.service';

@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    SafeFetchModule, // タイムアウト / サイズ上限 / SSRF ガード
    StorageModule, // #1375 4 巡目: 外部サムネイルの自ストレージ複製
    CloudTasksModule, // 複製後のリサイズジョブ投入
    DishCategoriesModule, // 候補のラベル解決（読み取りのみ）
    DishCategoryVariantsModule, // 照合辞書（読み取りのみ）
    forwardRef(() => RestaurantsModule), // 近傍店舗の検索（読み取りのみ）
    forwardRef(() => AuthModule),
  ],
  controllers: [DishMediaImportsController],
  providers: [
    DishMediaImportsService,
    SnsOembedService,
    DishCategoryVariantDictionaryService,
  ],
  exports: [DishMediaImportsService],
})
export class DishMediaImportsModule {}

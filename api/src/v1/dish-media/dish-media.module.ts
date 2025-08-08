// api/src/modules/dish-media/dish-media.module.ts
//
// ❶ “最小構成で早く動かす” + ❷ “あとから機能を足しても破綻しない”
//    ────────────────────────────────────────────────
// - Controller / Service / Repository を DI で結線
// - 共通横串（Prisma, Logger, Storage, Auth）を imports に集約
// - Service を外部の Module から再利用しやすいよう `exports:` で公開
//

import { Module, forwardRef } from '@nestjs/common';
import { DishMediaController } from './dish-media.controller';
import { DishMediaService } from './dish-media.service';
import { DishMediaRepository } from './dish-media.repository';
import { DishMediaMapper } from './dish-media.mapper';

// ─── 横串インフラ層 ──────────────────────────────────────────
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { StorageModule } from '../../core/storage/storage.module'; // 署名 URL 発行用
import { AuthModule } from '../../core/auth/auth.module'; // JWT Guard / CurrentUser デコレータ

@Module({
  imports: [
    PrismaModule, // DB アクセス（@Global でも明示的 import が可読性↑）
    LoggerModule, // アプリ共通 Logger
    StorageModule, // 画像用 GCS / S3 署名 URL ユーティリティ
    forwardRef(() => AuthModule), // 双方向依存を避けるため forwardRef
  ],
  controllers: [DishMediaController],
  providers: [
    DishMediaService,
    DishMediaRepository, // ← ここで DI できるので Service から注入可能
    DishMediaMapper, // 追加: DishMediaMapper をプロバイダーとして登録
  ],
  exports: [
    DishMediaService, // 他ドメインが “いいね数集計” 等で再利用できる
  ],
})
export class DishMediaModule { }

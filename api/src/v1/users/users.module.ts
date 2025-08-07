// api/src/v1/users/users.module.ts
//
// ❶ "最小構成で早く動かす" + ❷ "あとから機能を足しても破綻しない"
//    ────────────────────────────────────────────────
// - Controller / Service / Repository を DI で結線
// - 共通横串（Prisma, Logger, Storage, Auth）を imports に集約
// - Service を外部の Module から再利用しやすいよう `exports:` で公開
//

import { Module, forwardRef } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { UsersMapper } from './users.mapper';

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
  controllers: [UsersController],
  providers: [
    UsersService,
    UsersRepository, // ← ここで DI できるので Service から注入可能
    UsersMapper,
  ],
  exports: [
    UsersService, // 他ドメインが参照できるよう公開
  ],
})
export class UsersModule {}

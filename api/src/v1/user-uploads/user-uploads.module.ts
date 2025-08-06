// api/src/v1/user-uploads/user-uploads.module.ts
//
// ❶ "最小構成で早く動かす" + ❂ "あとから機能を足しても破綻しない"
//    ────────────────────────────────────────────────
// - Controller / Service を DI で結線
// - 共通横串（Logger, Storage, Auth）を imports に集約
// - Service を外部の Module から再利用しやすいよう `exports:` で公開
//

import { Module, forwardRef } from '@nestjs/common';
import { UserUploadsController } from './user-uploads.controller';
import { UserUploadsService } from './user-uploads.service';

// ─── 横串インフラ層 ──────────────────────────────────────────
import { LoggerModule } from '../../core/logger/logger.module';
import { StorageModule } from '../../core/storage/storage.module'; // GCS 署名 URL 発行用
import { AuthModule } from '../../core/auth/auth.module'; // JWT Guard / CurrentUser デコレータ

@Module({
  imports: [
    LoggerModule, // アプリ共通 Logger
    StorageModule, // GCS 署名 URL ユーティリティ
    forwardRef(() => AuthModule), // 双方向依存を避けるため forwardRef
  ],
  controllers: [UserUploadsController],
  providers: [UserUploadsService],
  exports: [
    UserUploadsService, // 他ドメインがファイルアップロード機能で再利用できる
  ],
})
export class UserUploadsModule {}

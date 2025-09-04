// api/src/v1/user-uploads/user-uploads.module.ts
//
// ❶ Module for user-uploads domain
// ❷ Following the pattern from dish-media/dish-media.module.ts
// ❃ Provides signed URL generation for user file uploads

import { Module, forwardRef } from '@nestjs/common';
import { UserUploadsController } from './user-uploads.controller';
import { UserUploadsService } from './user-uploads.service';

// ─── 横串インフラ層 ──────────────────────────────────────────
import { LoggerModule } from '../../core/logger/logger.module';
import { StorageModule } from '../../core/storage/storage.module';
import { AuthModule } from '../../core/auth/auth.module';

@Module({
  imports: [
    LoggerModule, // アプリ共通 Logger
    StorageModule, // GCS 署名付き URL ユーティリティ
    forwardRef(() => AuthModule), // 双方向依存を避けるため forwardRef
  ],
  controllers: [UserUploadsController],
  providers: [UserUploadsService],
  exports: [
    UserUploadsService, // 他ドメインから利用できるよう export
  ],
})
export class UserUploadsModule {}

// api/src/v1/users/users.assembler.ts
//
// Assembler for composing user-related response models
//

import { Injectable } from '@nestjs/common';
import { UserProfile } from '@shared/v1/res';
import { StorageService } from '../../core/storage/storage.service';
import { buildResizedPath } from '../../core/storage/storage.utils';
import {
  convertPrismaToSupabase_Users,
  PrismaUsers,
  SupabaseUsers,
} from '../../../../shared/converters/convert_users';

@Injectable()
export class UsersAssembler {
  constructor(private readonly storage: StorageService) { }

  /**
   * ユーザープロフィールに avatar URL 群を付与
   */
  enrichUserProfileWithAvatarUrls(
    user: PrismaUsers,
  ): UserProfile {
    const supabaseUsers: SupabaseUsers = convertPrismaToSupabase_Users(user);

    // #プロフィール画像 【設計】avatar_path がある場合のみ
    // 派生サイズ の CDN 署名付きURL群 を生成して付与する
    let avatarUrls: { sm: string; md: string } | undefined;
    if (user.avatar_path) {
      // アバター画像の派生サイズ CDN URL 群
      avatarUrls = {
        sm: this.storage.generateCdnSignedURL(buildResizedPath(
          {
            table: 'users',
            column: 'avatar_path',
            recordId: user.id,
            size: 64,
            originalPath: user.avatar_path,
          },
          'cdn',
        )),
        md: this.storage.generateCdnSignedURL(buildResizedPath(
          {
            table: 'users',
            column: 'avatar_path',
            recordId: user.id,
            size: 256,
            originalPath: user.avatar_path,
          },
          'cdn',
        )),
      };
    }

    return { ...supabaseUsers, avatarUrls };
  }
}

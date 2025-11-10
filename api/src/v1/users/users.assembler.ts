// api/src/v1/users/users.assembler.ts
//
// Assembler for composing user-related response models
//

import { Injectable } from '@nestjs/common';
import { UserProfile } from '@shared/v1/res';
import { StorageService } from '../../core/storage/storage.service';
import { buildResizedPath } from '../../core/storage/storage.utils';
import { convertPrismaToSupabase_Users, PrismaUsers, SupabaseUsers } from '../../../../shared/converters/convert_users';

@Injectable()
export class UsersAssembler {
  constructor(private readonly storage: StorageService) { }

  /**
   * ユーザープロフィールに avatar URL 群を付与
   */
  async enrichUserProfileWithAvatarUrls(user: PrismaUsers): Promise<UserProfile> {
    const supabaseUsers: SupabaseUsers = convertPrismaToSupabase_Users(user);

    // #プロフィール画像 【設計】avatar_path がある場合のみ
    // 署名付きURL, 派生サイズ の CDN URL, URL群 を生成して付与する
    let avatarSignedUrl: string | undefined;
    let avatarUrls: { sm: string; md: string } | undefined;
    if (user.avatar_path) {
      // アバター画像の署名付きURL（原本）
      avatarSignedUrl = await this.storage.generateSignedUrl(user.avatar_path);

      // アバター画像の派生サイズ CDN URL 群
      avatarUrls = {
        sm: buildResizedPath(
          {
            table: 'users',
            column: 'avatar',
            recordId: user.id,
            size: 64,
            originalPath: user.avatar_path,
          },
          'cdn',
        ),
        md: buildResizedPath(
          {
            table: 'users',
            column: 'avatar',
            recordId: user.id,
            size: 256,
            originalPath: user.avatar_path,
          },
          'cdn',
        ),
      };

      this.storage.generateCdnSignedCookies(avatarUrls.sm.split('/').slice(0, -1).join('/'));
    }

    return { ...supabaseUsers, avatarSignedUrl, avatarUrls };
  }
}

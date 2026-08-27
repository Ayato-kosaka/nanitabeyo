// api/src/v1/users/users.service.delete-me.spec.ts
//
// #1511 ACC-01 アカウント削除（DELETE /v1/users/me）の単体テスト。
//
// ここで守りたいのは「削除の順序」と「失敗の握り方」である。どちらも実装を眺めても
// 正しさが分からず、間違っても画面上は成功に見えるため、テストでしか固定できない:
//
//   1. **匿名化より «前» に avatar_path を読むこと。** 匿名化が avatar_path を NULL に
//      するので、順序が入れ替わるとアバターの実体が GCS に残り続ける（誰も気付かない）
//   2. **auth 削除の失敗を成功として返さないこと。** ここを握ると
//      「削除したはずの資格情報でログインできる」状態を success で返してしまう
//   3. **ストレージの失敗では止まらないこと。** ここで throw すると auth 削除へ到達せず、
//      2 より悪い「消えていないのにログインもできない」ではなく「ログインできるまま」になる

// core/config/env は import 時に process.env をバリデーションして throw するため、
// 実 DB・実 API に触れない単体テストでも .env が無いと suite ごと落ちる。
// users.service.ts は logger / storage 経由でこれを推移的に読み込むので、
// DI で差し替えるより手前、モジュール解決の段階で無害化する
//（dish-media.service.spec.ts と同じ手当て）。
jest.mock('../../core/config/env', () => ({
  env: new Proxy(
    {},
    {
      get: (_target, key: string) =>
        key === 'DB_POOL_MAX' ? 1 : `test-${key}`,
    },
  ),
}));

import { ServiceUnavailableException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { UsersAssembler } from './users.assembler';
import { AppLoggerService } from '../../core/logger/logger.service';
import { DishMediaRepository } from '../dish-media/dish-media.repository';
import { DishMediaService } from '../dish-media/dish-media.service';
import { DishCategoriesRepository } from '../dish-categories/dish-categories.repository';
import { RestaurantsRepository } from '../restaurants/restaurants.repository';
import { RestaurantsAssembler } from '../restaurants/restaurants.assembler';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import { StorageService } from '../../core/storage/storage.service';
// #1596 UsersService のコンストラクタへ後から足された 3 つ。
// 足したときにこの suite を更新し忘れたため、Nest が
// «DishMediaAssembler at index [9] is available?» で組み立てに失敗し、
// **アカウント削除の回帰テスト 6 件が 1 度も走っていなかった**。
import { DishMediaAssembler } from '../dish-media/dish-media.assembler';
import { DishCategoryGroupVotesRepository } from '../dish-category-group-votes/dish-category-group-votes.repository';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SupabaseAdminNotConfiguredError,
  SupabaseAdminService,
} from '../../core/supabase-admin/supabase-admin.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const DELETED_AT = new Date('2026-08-23T12:00:00.000Z');

/** 削除前のユーザー行（PII が入っている状態） */
const liveUser = {
  id: USER_ID,
  username: 'tabelog_taro',
  display_name: 'たべろぐ太郎',
  bio: 'ラーメンが好きです',
  avatar_path: 'development/user-uploads/' + USER_ID + '/avatar.jpg',
  preferred_locale: 'ja-JP',
  last_login_at: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
  lock_no: 0,
  deleted_at: null,
};

const dishMediaRows = [
  {
    id: '22222222-2222-4222-8222-222222222222',
    media_path: 'development/user-uploads/' + USER_ID + '/ramen.mp4',
    thumbnail_path: 'development/user-uploads/' + USER_ID + '/ramen.jpg',
  },
];

const softDeleteResult = {
  deletedAt: DELETED_AT,
  likesDeleted: 3,
  reactionsDeleted: 2,
  deviceTokensDeleted: 1,
  notificationCursorsDeleted: 1,
  notificationRecipientsDeleted: 4,
  rolesDeleted: 0,
  likeTotalsRecalculated: 3,
};

describe('UsersService#deleteMe (#1511)', () => {
  let service: UsersService;
  let repo: jest.Mocked<Pick<
    UsersRepository,
    'getUserByIdIncludingDeleted' | 'findDishMediaPathsByUser' | 'softDeleteUserAccount'
  >>;
  let storage: { deleteFileIfExists: jest.Mock; deleteFilesByPrefix: jest.Mock };
  let supabaseAdmin: { deleteAuthUser: jest.Mock; isConfigured: jest.Mock };

  beforeEach(async () => {
    repo = {
      getUserByIdIncludingDeleted: jest.fn().mockResolvedValue(liveUser),
      findDishMediaPathsByUser: jest.fn().mockResolvedValue(dishMediaRows),
      softDeleteUserAccount: jest.fn().mockResolvedValue(softDeleteResult),
    } as any;
    storage = {
      deleteFileIfExists: jest.fn().mockResolvedValue(true),
      deleteFilesByPrefix: jest.fn().mockResolvedValue(undefined),
    };
    supabaseAdmin = {
      deleteAuthUser: jest.fn().mockResolvedValue(undefined),
      isConfigured: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repo },
        { provide: UsersAssembler, useValue: {} },
        {
          provide: AppLoggerService,
          useValue: {
            debug: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
        { provide: DishMediaRepository, useValue: {} },
        { provide: DishMediaService, useValue: {} },
        { provide: DishCategoriesRepository, useValue: {} },
        { provide: CloudTasksService, useValue: {} },
        { provide: RestaurantsRepository, useValue: {} },
        { provide: RestaurantsAssembler, useValue: {} },
        { provide: DishMediaAssembler, useValue: {} },
        { provide: DishCategoryGroupVotesRepository, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: StorageService, useValue: storage },
        { provide: SupabaseAdminService, useValue: supabaseAdmin },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('匿名化・ストレージ削除・auth 削除をこの順で行い、削除時刻を返す', async () => {
    const result = await service.deleteMe(USER_ID);

    expect(result).toEqual({
      success: true,
      deletedAt: DELETED_AT.toISOString(),
    });

    // ⚠️ 順序が本体。匿名化より «後» に avatar_path を読むと NULL になっていて実体が消せない
    const readOrder = repo.getUserByIdIncludingDeleted.mock.invocationCallOrder[0];
    const anonymizeOrder = repo.softDeleteUserAccount.mock.invocationCallOrder[0];
    const storageOrder = storage.deleteFileIfExists.mock.invocationCallOrder[0];
    const authOrder = supabaseAdmin.deleteAuthUser.mock.invocationCallOrder[0];
    expect(readOrder).toBeLessThan(anonymizeOrder);
    expect(anonymizeOrder).toBeLessThan(storageOrder);
    expect(storageOrder).toBeLessThan(authOrder);

    // アバターと投稿メディアのオリジナルが対象になっていること
    expect(storage.deleteFileIfExists).toHaveBeenCalledWith(liveUser.avatar_path);
    expect(storage.deleteFileIfExists).toHaveBeenCalledWith(dishMediaRows[0].media_path);
    expect(storage.deleteFileIfExists).toHaveBeenCalledWith(dishMediaRows[0].thumbnail_path);

    // 派生ファイル（サイズ・フォーマットを知らない）は前方一致で消していること
    const prefixes = storage.deleteFilesByPrefix.mock.calls.map((c) => c[0]);
    expect(prefixes).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`resized-image/users/avatar_path/${USER_ID}`),
        expect.stringContaining(`resized-image/dish_media/media_path/${dishMediaRows[0].id}`),
        expect.stringContaining(`transcoded-video/dish_media/media_path/${dishMediaRows[0].id}`),
      ]),
    );

    expect(supabaseAdmin.deleteAuthUser).toHaveBeenCalledWith(USER_ID);
  });

  it('削除済みユーザーでも再実行できる（冪等）', async () => {
    // 1 回目で匿名化された行。`getUserById` なら null になるが、削除処理はこちらを使う
    repo.getUserByIdIncludingDeleted.mockResolvedValue({
      ...liveUser,
      username: `deleted_${USER_ID}`,
      display_name: null,
      bio: null,
      avatar_path: null,
      deleted_at: DELETED_AT,
    } as any);

    await expect(service.deleteMe(USER_ID)).resolves.toEqual({
      success: true,
      deletedAt: DELETED_AT.toISOString(),
    });

    // avatar_path が既に NULL なので、オリジナルの削除は «呼ばれない»。
    // それでも派生の前方一致削除は走る（1 回目が途中で落ちていた場合の取りこぼし回収）
    expect(storage.deleteFileIfExists).not.toHaveBeenCalledWith(liveUser.avatar_path);
    expect(storage.deleteFilesByPrefix).toHaveBeenCalled();
    expect(supabaseAdmin.deleteAuthUser).toHaveBeenCalledWith(USER_ID);
  });

  it('存在しないユーザーは 404（匿名化も auth 削除も行わない）', async () => {
    repo.getUserByIdIncludingDeleted.mockResolvedValue(null as any);

    await expect(service.deleteMe(USER_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.softDeleteUserAccount).not.toHaveBeenCalled();
    expect(supabaseAdmin.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('service_role 鍵が未設定なら 503（成功として返さない）', async () => {
    supabaseAdmin.deleteAuthUser.mockRejectedValue(
      new SupabaseAdminNotConfiguredError(),
    );

    await expect(service.deleteMe(USER_ID)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    // DB 側の匿名化は «完了させてから» 失敗すること。
    // ここを実行しないと再送しても永久に完了しない
    expect(repo.softDeleteUserAccount).toHaveBeenCalledWith(USER_ID);
  });

  it('auth 削除が失敗したら 503（再ログインできる状態を success にしない）', async () => {
    supabaseAdmin.deleteAuthUser.mockRejectedValue(new Error('502 Bad Gateway'));

    await expect(service.deleteMe(USER_ID)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('ストレージ削除が失敗しても auth 削除まで到達する', async () => {
    // 実体が消せないことより、認証が生き残ることのほうが害が大きい
    storage.deleteFileIfExists.mockRejectedValue(new Error('GCS unavailable'));

    await expect(service.deleteMe(USER_ID)).resolves.toMatchObject({
      success: true,
    });
    expect(supabaseAdmin.deleteAuthUser).toHaveBeenCalledWith(USER_ID);
  });
});

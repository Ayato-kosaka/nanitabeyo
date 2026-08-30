// api/src/v1/notifications/notification-preferences.service.spec.ts
//
// ❶ #1510 SET-02 受信設定の読み書きと「未設定 = 既定値」の解決を固定する
// ❷ 完了条件「設定していない既存ユーザーの挙動が変わらない」は
//    「行が 0 件でも isPushAllowedForKind が true」で表現される
// ❸ 対応表に無い組が来たときに送信side（true）へ倒れることも固定する。
//    ここを false 側に倒すと、#1506 で新種別を足したのに対応表への登録を忘れた瞬間、
//    通知がエラーも出さずに消える
//

jest.mock('../../core/config/env', () => ({
  env: new Proxy(
    {},
    {
      get: (_target, key: string) =>
        key === 'DB_POOL_MAX' ? 1 : `test-${key}`,
    },
  ),
}));

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';
import { AppLoggerService } from '../../core/logger/logger.service';
import { UsersService } from '../users/users.service';
import { UsersAssembler } from '../users/users.assembler';
import { DishMediaService } from '../dish-media/dish-media.service';
import { DishMediaRepository } from '../dish-media/dish-media.repository';

const USER_ID = 'user-uuid';

describe('#1510 SET-02 通知カテゴリ別の受信設定', () => {
  let service: NotificationsService;
  let repo: {
    findNotificationPreferences: jest.Mock;
    findNotificationPreference: jest.Mock;
    upsertNotificationPreference: jest.Mock;
  };
  let logger: {
    debug: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    log: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      findNotificationPreferences: jest.fn().mockResolvedValue([]),
      findNotificationPreference: jest.fn().mockResolvedValue(null),
      upsertNotificationPreference: jest.fn().mockResolvedValue(undefined),
    };

    logger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: NotificationsRepository, useValue: repo },
        { provide: AppLoggerService, useValue: logger },
        { provide: UsersService, useValue: {} },
        { provide: UsersAssembler, useValue: {} },
        { provide: DishMediaService, useValue: {} },
        { provide: DishMediaRepository, useValue: {} },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe('GET /v1/users/me/notification-preferences', () => {
    it('行が 1 件も無くても全カテゴリを既定値（オン）で返す', async () => {
      const result = await service.getMyNotificationPreferences(USER_ID);

      expect(result.data).toEqual([
        { category: 'likes', enabled: true },
        { category: 'saves', enabled: true },
        { category: 'group_votes', enabled: true },
      ]);
    });

    it('保存済みの値は既定値より優先される', async () => {
      repo.findNotificationPreferences.mockResolvedValue([
        { category: 'likes', enabled: false },
      ]);

      const result = await service.getMyNotificationPreferences(USER_ID);

      expect(result.data).toEqual([
        { category: 'likes', enabled: false },
        { category: 'saves', enabled: true },
        { category: 'group_votes', enabled: true },
      ]);
    });
  });

  describe('PATCH /v1/users/me/notification-preferences/:category', () => {
    it('upsert して更新後の値を返す', async () => {
      const result = await service.updateMyNotificationPreference(
        USER_ID,
        'saves',
        false,
      );

      expect(repo.upsertNotificationPreference).toHaveBeenCalledWith(
        USER_ID,
        'saves',
        false,
      );
      expect(result).toEqual({ category: 'saves', enabled: false });
    });

    it('未知のカテゴリは 400 で弾き、DB に幽霊行を作らない', async () => {
      await expect(
        service.updateMyNotificationPreference(USER_ID, 'unknown_category', false),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repo.upsertNotificationPreference).not.toHaveBeenCalled();
    });
  });

  describe('isPushAllowedForKind（配信直前の判定）', () => {
    it('未設定（行なし）なら送る＝既存ユーザーの挙動は変わらない', async () => {
      const result = await service.isPushAllowedForKind(USER_ID, {
        targetTable: 'dish_media',
        actionType: 'like',
      });

      expect(result).toEqual({ allowed: true, category: 'likes' });
    });

    it('オフに設定していれば送らない', async () => {
      repo.findNotificationPreference.mockResolvedValue(false);

      const result = await service.isPushAllowedForKind(USER_ID, {
        targetTable: 'dish_media',
        actionType: 'like',
      });

      expect(result).toEqual({ allowed: false, category: 'likes' });
      expect(repo.findNotificationPreference).toHaveBeenCalledWith(
        USER_ID,
        'likes',
      );
    });

    it('dish_reviews の like も likes カテゴリに束ねられる', async () => {
      repo.findNotificationPreference.mockResolvedValue(false);

      const result = await service.isPushAllowedForKind(USER_ID, {
        targetTable: 'dish_reviews',
        actionType: 'like',
      });

      expect(result).toEqual({ allowed: false, category: 'likes' });
    });

    it('like をオフにしても save は saves カテゴリなので独立して判定される', async () => {
      repo.findNotificationPreference.mockImplementation(
        (_userId: string, category: string) =>
          Promise.resolve(category === 'likes' ? false : null),
      );

      await expect(
        service.isPushAllowedForKind(USER_ID, {
          targetTable: 'dish_media',
          actionType: 'save',
        }),
      ).resolves.toEqual({ allowed: true, category: 'saves' });
    });

    it('対応表に無い組は送る側へ倒し、warn を残す', async () => {
      const result = await service.isPushAllowedForKind(USER_ID, {
        targetTable: 'unknown_table',
        actionType: 'unknown_action',
      });

      expect(result).toEqual({ allowed: true, category: null });
      // 未知の組では設定を引きに行かない（引くべきカテゴリが決まらないため）
      expect(repo.findNotificationPreference).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'NotificationCategoryUnmapped',
        'isPushAllowedForKind',
        expect.objectContaining({ targetTable: 'unknown_table' }),
      );
    });
  });
});

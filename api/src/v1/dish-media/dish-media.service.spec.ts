// api/src/v1/dish-media/dish-media.service.spec.ts
//
// ❶ #1223 / #1222 二次対策の回帰テスト
// ❷ impression / view は解析用テレメトリなので、参照先がまだ存在しない
//    タイミング障害（Prisma P2003）では 500 を返さない
// ❸ ただし握るのは P2003 だけで、他のエラーは従来どおり伝播させる
//

// core/config/env は import 時に process.env をバリデーションして throw するため、
// 実DB・実APIに触れない単体テストでも .env が無いと suite ごと落ちる。
// dish-media.service.ts は logger / storage 経由でこれを推移的に読み込むので、
// DI で差し替えるより手前、モジュール解決の段階で無害化する。
jest.mock('../../core/config/env', () => ({
  env: new Proxy(
    {},
    {
      get: (_target, key: string) =>
        key === 'DB_POOL_MAX' ? 1 : `test-${key}`,
    },
  ),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { DishMediaService } from './dish-media.service';
import { DishMediaRepository } from './dish-media.repository';
import { DishMediaAssembler } from './dish-media.assembler';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { TranscoderService } from '../../core/transcoder/transcoder.service';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import { ClsService } from 'nestjs-cls';
import type { CreateDishMediaViewDto } from '@shared/v1/dto';

const DISH_MEDIA_ID = 'dish-media-uuid';
const IMPRESSION_ID = 'impression-uuid';
const USER_ID = 'user-uuid';

const impressionBody = {
  id: IMPRESSION_ID,
  session_id: 'session-uuid',
  source: 'search',
};

const viewDto = {
  impression_id: IMPRESSION_ID,
  started_at: new Date('2026-08-10T00:00:00.000Z'),
  watch_ms: 1200,
  is_completed: true,
  is_skipped: false,
  rewatch_count: 0,
} as CreateDishMediaViewDto;

/**
 * Prisma が FK 違反で投げるエラー相当。
 * `meta.field_name` は Postgres の制約名が入る。
 */
const buildForeignKeyViolation = (fieldName?: string) =>
  Object.assign(new Error('Foreign key constraint violated'), {
    code: 'P2003',
    ...(fieldName ? { meta: { field_name: fieldName } } : {}),
  });

describe('DishMediaService テレメトリの FK 違反ハンドリング', () => {
  let service: DishMediaService;
  let repo: {
    addImpression: jest.Mock;
    createDishMediaView: jest.Mock;
    toggleReaction: jest.Mock;
  };
  let prisma: { withTransaction: jest.Mock };
  let cloudTasks: { enqueueNotification: jest.Mock };
  let logger: {
    debug: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    log: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      addImpression: jest.fn().mockResolvedValue(undefined),
      createDishMediaView: jest.fn().mockResolvedValue({
        id: 'view-uuid',
        dish_media_id: DISH_MEDIA_ID,
        impression_id: IMPRESSION_ID,
      }),
      toggleReaction: jest.fn().mockResolvedValue(undefined),
    };
    cloudTasks = {
      enqueueNotification: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      // withTransaction は tx を渡して実行するだけのパススルー
      withTransaction: jest.fn((exec: (tx: unknown) => unknown) =>
        exec({ __tx: true }),
      ),
    };
    logger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishMediaService,
        { provide: DishMediaRepository, useValue: repo },
        { provide: DishMediaAssembler, useValue: {} },
        { provide: PrismaService, useValue: prisma },
        { provide: AppLoggerService, useValue: logger },
        { provide: TranscoderService, useValue: {} },
        { provide: CloudTasksService, useValue: cloudTasks },
        { provide: ClsService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<DishMediaService>(DishMediaService);
  });

  describe('#1223 impression', () => {
    it('正常時は従来どおり addImpression を呼ぶ', async () => {
      await service.addImpression(DISH_MEDIA_ID, USER_ID, impressionBody);

      expect(repo.addImpression).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    // 63件/24人 の 500 の直接原因。bulk-import の遅延登録が間に合わないだけで
    // ユーザー体験を壊す価値はない。
    it('dish_media_id の FK 違反(P2003)で 500 にせず warn で握る', async () => {
      repo.addImpression.mockRejectedValue(
        buildForeignKeyViolation(
          'dish_media_impressions_dish_media_id_fkey (index)',
        ),
      );

      await expect(
        service.addImpression(DISH_MEDIA_ID, USER_ID, impressionBody),
      ).resolves.toBeUndefined();
    });

    // 握りつぶすだけにはしない。件数を数えられるログを必ず残す。
    it('握った FK 違反は件数を数えられる warn ログに残す', async () => {
      repo.addImpression.mockRejectedValue(
        buildForeignKeyViolation(
          'dish_media_impressions_dish_media_id_fkey (index)',
        ),
      );

      await service.addImpression(DISH_MEDIA_ID, USER_ID, impressionBody);

      expect(logger.warn).toHaveBeenCalledWith(
        'DishMediaImpressionForeignKeyViolation',
        'addImpression',
        expect.objectContaining({
          dishMediaId: DISH_MEDIA_ID,
          impressionId: IMPRESSION_ID,
          userId: USER_ID,
        }),
      );
    });

    // この経路が書き込む3テーブルの FK は dish_media_id / impression_id しか無いため、
    // field_name が取れなくてもタイミング障害と断定してよい
    it('field_name が取れない P2003 も握る', async () => {
      repo.addImpression.mockRejectedValue(buildForeignKeyViolation());

      await expect(
        service.addImpression(DISH_MEDIA_ID, USER_ID, impressionBody),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'DishMediaImpressionForeignKeyViolation',
        'addImpression',
        expect.objectContaining({ fieldName: 'unknown' }),
      );
    });

    it('P2003 以外の Prisma エラーは従来どおり伝播させる', async () => {
      const error = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      });
      repo.addImpression.mockRejectedValue(error);

      await expect(
        service.addImpression(DISH_MEDIA_ID, USER_ID, impressionBody),
      ).rejects.toBe(error);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('Prisma 以外のエラーも従来どおり伝播させる', async () => {
      const error = new Error('DB circuit open (temporarily unavailable)');
      repo.addImpression.mockRejectedValue(error);

      await expect(
        service.addImpression(DISH_MEDIA_ID, USER_ID, impressionBody),
      ).rejects.toBe(error);
    });

    // 対象外の FK まで握ると、本当のデータ不整合を warn に埋めてしまう
    it('dish_media / impression 以外の FK 違反は伝播させる', async () => {
      const error = buildForeignKeyViolation('payouts_user_id_fkey (index)');
      repo.addImpression.mockRejectedValue(error);

      await expect(
        service.addImpression(DISH_MEDIA_ID, USER_ID, impressionBody),
      ).rejects.toBe(error);
    });
  });

  describe('#1222 view', () => {
    it('正常時は stored: true を返す', async () => {
      await expect(
        service.createDishMediaView(DISH_MEDIA_ID, viewDto, USER_ID),
      ).resolves.toEqual({
        id: 'view-uuid',
        dish_media_id: DISH_MEDIA_ID,
        impression_id: IMPRESSION_ID,
        stored: true,
        analysis_applied: true,
      });
    });

    // impression が FK 違反で作られなかった場合、それを参照する view も落ちる（連鎖）
    it('impression_id の FK 違反で 500 にせず stored: false を返す', async () => {
      repo.createDishMediaView.mockRejectedValue(
        buildForeignKeyViolation('dish_media_views_impression_id_fkey (index)'),
      );

      await expect(
        service.createDishMediaView(DISH_MEDIA_ID, viewDto, USER_ID),
      ).resolves.toEqual({
        id: null,
        dish_media_id: DISH_MEDIA_ID,
        impression_id: IMPRESSION_ID,
        stored: false,
        analysis_applied: false,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        'DishMediaViewForeignKeyViolation',
        'createDishMediaView',
        expect.objectContaining({ dishMediaId: DISH_MEDIA_ID }),
      );
    });

    it('dish_media_id の FK 違反も同様に握る', async () => {
      repo.createDishMediaView.mockRejectedValue(
        buildForeignKeyViolation('dish_media_views_dish_media_id_fkey (index)'),
      );

      await expect(
        service.createDishMediaView(DISH_MEDIA_ID, viewDto, USER_ID),
      ).resolves.toMatchObject({ stored: false });
    });

    it('P2003 以外は従来どおり伝播させる', async () => {
      const error = new Error('boom');
      repo.createDishMediaView.mockRejectedValue(error);

      await expect(
        service.createDishMediaView(DISH_MEDIA_ID, viewDto, USER_ID),
      ).rejects.toBe(error);
    });

    // 既存バリデーション。FK ハンドリングを足しても壊れていないこと。
    it('is_completed と is_skipped が同時 true なら従来どおり throw する', async () => {
      await expect(
        service.createDishMediaView(
          DISH_MEDIA_ID,
          { ...viewDto, is_skipped: true } as CreateDishMediaViewDto,
          USER_ID,
        ),
      ).rejects.toThrow('View cannot be both completed and skipped');
      expect(repo.createDishMediaView).not.toHaveBeenCalled();
    });
  });

  // #1223 レビュー指摘 Minor-1。
  // like / save / open_map も「まだ DB に無い dish_media.id」を掴むと落ちる。
  // dish_media_likes.dish_media_id も dish_media_analysis_results.dish_media_id も
  // dish_media への FK なので、原因は impression / view とまったく同じ。
  describe('#1223 reaction', () => {
    it('正常時は従来どおり toggleReaction を呼ぶ', async () => {
      await service.addReaction(DISH_MEDIA_ID, 'like', USER_ID, false);

      expect(repo.toggleReaction).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('dish_media_id の FK 違反(P2003)で 500 にせず warn で握る', async () => {
      repo.toggleReaction.mockRejectedValue(
        buildForeignKeyViolation('dish_media_likes_dish_media_id_fkey (index)'),
      );

      await expect(
        service.addReaction(DISH_MEDIA_ID, 'like', USER_ID, false),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'DishMediaReactionForeignKeyViolation',
        'addReaction',
        expect.objectContaining({
          dishMediaId: DISH_MEDIA_ID,
          userId: USER_ID,
          actionType: 'like',
        }),
      );
    });

    // 行が無い以上リアクションは保存されていない。実体の無い like の通知を飛ばさない。
    it('FK 違反を握ったときは通知ジョブを積まない', async () => {
      repo.toggleReaction.mockRejectedValue(
        buildForeignKeyViolation('dish_media_likes_dish_media_id_fkey (index)'),
      );

      await service.addReaction(DISH_MEDIA_ID, 'like', USER_ID, false);

      expect(cloudTasks.enqueueNotification).not.toHaveBeenCalled();
    });

    it('save / open_map（reactions 経由）でも同様に握る', async () => {
      repo.toggleReaction.mockRejectedValue(
        buildForeignKeyViolation(
          'dish_media_analysis_results_dish_media_id_fkey (index)',
        ),
      );

      await expect(
        service.addReaction(DISH_MEDIA_ID, 'open_map', USER_ID, false),
      ).resolves.toBeUndefined();
    });

    it('解除側（removeReaction）でも同様に握る', async () => {
      repo.toggleReaction.mockRejectedValue(
        buildForeignKeyViolation(
          'dish_media_analysis_results_dish_media_id_fkey (index)',
        ),
      );

      await expect(
        service.removeReaction(DISH_MEDIA_ID, 'save', USER_ID, false),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'DishMediaReactionForeignKeyViolation',
        'removeReaction',
        expect.objectContaining({ willReact: false }),
      );
    });

    // impression / view と違い dish_media_likes は user_id にも FK を持つ。
    // field_name 不明を握ると「存在しない user_id」という本物の不整合まで warn に埋まる。
    it('field_name が取れない P2003 は握らず伝播させる', async () => {
      const error = buildForeignKeyViolation();
      repo.toggleReaction.mockRejectedValue(error);

      await expect(
        service.addReaction(DISH_MEDIA_ID, 'like', USER_ID, false),
      ).rejects.toBe(error);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('user_id の FK 違反は握らず伝播させる', async () => {
      const error = buildForeignKeyViolation(
        'dish_media_likes_user_id_fkey (index)',
      );
      repo.toggleReaction.mockRejectedValue(error);

      await expect(
        service.addReaction(DISH_MEDIA_ID, 'like', USER_ID, false),
      ).rejects.toBe(error);
    });

    // like の二重押下は P2002。握ると「押せているのに保存されていない」状態になる。
    it('P2003 以外（二重 like の P2002 など）は従来どおり伝播させる', async () => {
      const error = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      });
      repo.toggleReaction.mockRejectedValue(error);

      await expect(
        service.addReaction(DISH_MEDIA_ID, 'like', USER_ID, false),
      ).rejects.toBe(error);
    });
  });
});

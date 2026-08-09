// api/src/v1/dish-categories/dish-categories.service.spec.ts
//
// #1196 address の形式と Claude フォールバックの関係を固定する
//

// core/config/env は import 時に process.env をバリデーションして throw するため、
// 実DB・実APIに触れない単体テストでも .env が無いと suite ごと落ちる。
// dish-categories.service.ts は repository 経由で PrismaService を推移的に読み込むので、
// DI で差し替えるより手前、モジュール解決の段階で無害化する（dishes.service.spec.ts と同じ手法）。
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
import { QueryDishCategoryRecommendationsDto } from '@shared/v1/dto';

import { DishCategoriesService } from './dish-categories.service';
import { DishCategoriesRepository } from './dish-categories.repository';
import { ClaudeService } from '../../core/claude/claude.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RemoteConfigService } from '../../core/remote-config/remote-config.service';
import { DishCategoryCandidateWithScores } from './dish-categories.interface';

/**
 * #1196 の本番障害を固定するテスト。
 *
 * 設計意図:
 *   address = "country:JP, administrative_area_level_1:大阪府, locality:大阪市"
 *     → normalizeInput が region_tokens = ["region:country:JP", ...] を作る
 *     → gate whitelist には 'region:country:JP' が入っているので必ずマッチする
 *     → 候補が返るので **Claude フォールバックは発火しない**
 *
 * 実際に起きたこと:
 *   クライアントが市区町村名単体("大阪市")を送っていたため region_tokens が ["region:大阪市"] になり、
 *   どのゲートにも当たらず候補0件 → fallbackToClaude が 1日 1,445件発火して失敗していた。
 *
 * ここでは (1) 壊れた形式を検知できること (2) 正規形式では Claude へ落ちないこと
 * (3) それでも海外向けの Claude 経路は残っていること、の 3 点を固定する。
 */
describe('#1196 DishCategoriesService の address 形式ハンドリング', () => {
  let service: DishCategoriesService;
  let repo: jest.Mocked<DishCategoriesRepository>;
  let claudeService: jest.Mocked<ClaudeService>;
  let logger: jest.Mocked<AppLoggerService>;

  const USER_ID = '00000000-0000-4000-8000-000000000001';

  /** 正規形式（クライアントが本来送るべき形） */
  const CANONICAL_ADDRESS =
    'country:JP, administrative_area_level_1:大阪府, locality:大阪市';
  /** #1196 本番で観測された壊れた形式（市区町村名単体） */
  const BROKEN_ADDRESS = '大阪市';

  const buildDto = (address: string): QueryDishCategoryRecommendationsDto =>
    ({
      address,
      timeSlot: 'lunch',
      scene: 'solo',
      languageTag: 'ja-JP',
      localLanguageCode: 'ja',
    }) as QueryDishCategoryRecommendationsDto;

  /** スレート(6枚)を構成できるだけの候補を作る */
  const buildCandidates = (count: number): DishCategoryCandidateWithScores[] =>
    Array.from({ length: count }, (_, i) => ({
      category_id: `category-${i}`,
      macro_genre: `genre-${i}`,
      budget_intent_score: 0,
      time_slot_score: 1,
      scene_score: 1,
      satiety_score: 0,
      dining_pace_score: 0,
      core_ingredient_score: 0,
      taste_score: 0,
      rel_score: 1,
      market_salience_score: 1,
      dine_out_orderability_score: 1,
      final_score: 1 - i * 0.01,
      rnd_value: 0,
      random_unit: 0,
      order_score: 1 - i * 0.01,
    }));

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishCategoriesService,
        {
          provide: DishCategoriesRepository,
          useValue: {
            findCategoryCandidatesWithScores: jest.fn().mockResolvedValue([]),
            findCategoryPenaltyFeatures: jest.fn().mockResolvedValue(new Map()),
            findCategoryDeepDiveFeatures: jest
              .fn()
              .mockResolvedValue(new Map()),
            findLocalizedTexts: jest.fn().mockResolvedValue([]),
            findDishCategoriesByNames: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ClaudeService,
          useValue: {
            generateDishCategoryRecommendations: jest
              .fn()
              .mockResolvedValue([]),
          },
        },
        {
          provide: AppLoggerService,
          useValue: {
            debug: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            prisma: {
              dish_categories: { findMany: jest.fn().mockResolvedValue([]) },
              reactions: { findMany: jest.fn().mockResolvedValue([]) },
            },
          },
        },
        {
          provide: RemoteConfigService,
          useValue: {
            // penalty weight 3 件（core_ingredient / taste / cooking_method）
            getRemoteConfigValues: jest
              .fn()
              .mockResolvedValue(['0.1', '0.1', '0.1']),
          },
        },
      ],
    }).compile();

    service = module.get(DishCategoriesService);
    repo = module.get(DishCategoriesRepository);
    claudeService = module.get(ClaudeService);
    logger = module.get(AppLoggerService);
  });

  describe('壊れた形式（市区町村名単体）の address', () => {
    it('region_tokens が "region:大阪市" になり、gate whitelist に当たらないことを示す', async () => {
      await service.getRecommendations(buildDto(BROKEN_ADDRESS), USER_ID);

      expect(repo.findCategoryCandidatesWithScores).toHaveBeenCalledWith(
        expect.objectContaining({
          addressTokens: ['大阪市'],
          // ホワイトリストは 'region:country:JP' しか持たないので、これは絶対にマッチしない
          regionTokens: ['region:大阪市'],
        }),
      );
    });

    it('#1196 【防御】黙って Claude へ落とさず MalformedAddressFormat を warn で残す', async () => {
      await service.getRecommendations(buildDto(BROKEN_ADDRESS), USER_ID);

      expect(logger.warn).toHaveBeenCalledWith(
        'MalformedAddressFormat',
        'normalizeInput',
        expect.objectContaining({
          address: BROKEN_ADDRESS,
          reason: 'missing_country_token',
        }),
      );
    });

    it.each(['名古屋市', '新宿区', '横浜市', '中央区', '北九州市'])(
      '本番で観測された他の実例 %s も検知する',
      async (address) => {
        await service.getRecommendations(buildDto(address), USER_ID);

        expect(logger.warn).toHaveBeenCalledWith(
          'MalformedAddressFormat',
          'normalizeInput',
          expect.objectContaining({ address }),
        );
      },
    );
  });

  describe('正規形式の address', () => {
    beforeEach(() => {
      // ゲートを通ってスレート(6枚)を構成できる状態を再現する
      const candidates = buildCandidates(8);
      repo.findCategoryCandidatesWithScores.mockResolvedValue(candidates);
      repo.findCategoryPenaltyFeatures.mockResolvedValue(new Map());
      const prisma = (service as any).prisma as {
        prisma: { dish_categories: { findMany: jest.Mock } };
      };
      prisma.prisma.dish_categories.findMany.mockResolvedValue(
        candidates.map((candidate) => ({
          id: candidate.category_id,
          label_en: `label-${candidate.category_id}`,
          labels: { ja: `ラベル-${candidate.category_id}` },
          image_url: 'https://example.test/image.png',
          macro_genre_qid: candidate.macro_genre,
        })),
      );
    });

    it('region_tokens に "region:country:JP" が含まれる', async () => {
      await service.getRecommendations(buildDto(CANONICAL_ADDRESS), USER_ID);

      expect(repo.findCategoryCandidatesWithScores).toHaveBeenCalledWith(
        expect.objectContaining({
          regionTokens: expect.arrayContaining(['region:country:JP']),
        }),
      );
    });

    it('MalformedAddressFormat の warn は出ない', async () => {
      await service.getRecommendations(buildDto(CANONICAL_ADDRESS), USER_ID);

      expect(logger.warn).not.toHaveBeenCalledWith(
        'MalformedAddressFormat',
        expect.anything(),
        expect.anything(),
      );
    });

    it('#1196 【本丸】Claude フォールバックへ落ちない', async () => {
      const items = await service.getRecommendations(
        buildDto(CANONICAL_ADDRESS),
        USER_ID,
      );

      expect(
        claudeService.generateDishCategoryRecommendations,
      ).not.toHaveBeenCalled();
      expect(items).toHaveLength(6);
    });
  });

  describe('#1196 【非退行】Claude フォールバック自体は残す', () => {
    it('正規形式でもホワイトリスト未整備の地域（海外）で候補0件なら Claude へ落ちる', async () => {
      repo.findCategoryCandidatesWithScores.mockResolvedValue([]);

      await service.getRecommendations(
        buildDto('country:MG, administrative_area_level_1:Antananarivo'),
        USER_ID,
      );

      expect(
        claudeService.generateDishCategoryRecommendations,
      ).toHaveBeenCalledTimes(1);
      // 海外の地点は形式が壊れているわけではないので、誤検知の warn を出さない
      expect(logger.warn).not.toHaveBeenCalledWith(
        'MalformedAddressFormat',
        expect.anything(),
        expect.anything(),
      );
    });
  });
});

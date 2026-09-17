import { Test, TestingModule } from '@nestjs/testing';
import { RestaurantsService } from './restaurants.service';
import { RestaurantsRepository } from './restaurants.repository';
import { RestaurantsAssembler } from './restaurants.assembler';
import { ExternalApiService } from '../../core/external-api/external-api.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { DishesRepository } from '../dishes/dishes.repository';
import { DishMediaService } from '../dish-media/dish-media.service';
import { DishMediaRepository } from '../dish-media/dish-media.repository';
import { LocationsService } from '../locations/locations.service';
import type { QueryRestaurantsDto } from '@shared/v1/dto';

/**
 * #1780 店の代替画像（dish_media サムネイル）の **引き方**を固定する。
 *
 * ⚠️ ここが守っているのは «画像が出ること» ではなく **«一覧が店の数だけクエリを
 *    撃たないこと»** である。フォールバックを assembler の中で引くと素直に書けるが、
 *    近隣一覧・店名検索は 1 リクエストで数十店を返すので、そのまま N+1 になる。
 *    まとめて 1 回引く形を、テストで固定しておく。
 */
describe('#1780 代替サムネイルは 1 クエリでまとめて引く', () => {
  const TX = {} as never;
  let service: RestaurantsService;
  let findFallbacks: jest.Mock;
  let searchNearbyRestaurants: jest.Mock;

  const row = (id: string, imagePath: string | null) => ({
    restaurant: { id, name: id, image_path: imagePath },
    meta: { reviewCount: 0, averageRating: 0, totalCents: 0, maxEndDate: null },
  });

  beforeEach(async () => {
    findFallbacks = jest.fn().mockResolvedValue(new Map());
    searchNearbyRestaurants = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestaurantsService,
        {
          provide: RestaurantsRepository,
          useValue: { searchNearbyRestaurants },
        },
        {
          provide: RestaurantsAssembler,
          useValue: {
            enrichRestaurantsWithImageUrls: jest.fn((r, fallback) => ({
              ...r,
              // 何が渡ったかを観測できるようにして返す
              __fallback: fallback ?? null,
            })),
          },
        },
        { provide: ExternalApiService, useValue: {} },
        {
          provide: PrismaService,
          useValue: { withTransaction: jest.fn((exec) => exec(TX)) },
        },
        {
          provide: AppLoggerService,
          useValue: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        { provide: DishesRepository, useValue: {} },
        { provide: DishMediaService, useValue: {} },
        {
          provide: DishMediaRepository,
          useValue: { findFallbackThumbnailsByRestaurantIds: findFallbacks },
        },
        { provide: LocationsService, useValue: {} },
      ],
    }).compile();

    service = module.get(RestaurantsService);
  });

  const search = () =>
    service.searchRestaurants({
      lat: 35,
      lng: 139,
      radius: 1000,
    } as QueryRestaurantsDto);

  it('画像を持たない店が何件あってもクエリは 1 回だけ', async () => {
    searchNearbyRestaurants.mockResolvedValue([
      row('r1', null),
      row('r2', null),
      row('r3', null),
    ]);

    await search();

    expect(findFallbacks).toHaveBeenCalledTimes(1);
    expect(findFallbacks).toHaveBeenCalledWith(TX, ['r1', 'r2', 'r3']);
  });

  it('image_path を持つ店は問い合わせない（代替が要らない）', async () => {
    searchNearbyRestaurants.mockResolvedValue([
      row('r1', 'dev/restaurants/image_path/r1/a.jpg'),
      row('r2', null),
    ]);

    await search();

    expect(findFallbacks).toHaveBeenCalledWith(TX, ['r2']);
  });

  it('全店が image_path を持つならクエリを撃たない', async () => {
    searchNearbyRestaurants.mockResolvedValue([
      row('r1', 'dev/restaurants/image_path/r1/a.jpg'),
    ]);

    await search();

    expect(findFallbacks).not.toHaveBeenCalled();
  });

  it('引いた代替が、その店の assembler へ渡る', async () => {
    const thumb = {
      id: 'media-2',
      thumbnail_path: 'p',
      thumbnail_processing_status: 'completed',
    };
    searchNearbyRestaurants.mockResolvedValue([
      row('r1', null),
      row('r2', null),
    ]);
    findFallbacks.mockResolvedValue(new Map([['r2', thumb]]));

    const result = await search();

    expect(
      (result[0].restaurant as never as { __fallback: unknown }).__fallback,
    ).toBeNull();
    expect(
      (result[1].restaurant as never as { __fallback: unknown }).__fallback,
    ).toBe(thumb);
  });
});

// api/src/v1/restaurants/restaurants.service.ts
//
// ❶ Controller から渡される DTO を受け取り Repository・Google Places・Payment を編成
// ❷ 1 メソッド = 1 ユースケース（トランザクション／ロギング込み）
// ❸ "副作用" は出来るだけ Service で完結させ、Controller は薄く保つ
//

import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';

import {
  QueryRestaurantsDto,
  CreateRestaurantDto,
  CreateRestaurantBidIntentDto,
  QueryRestaurantDishMediaDto,
  QueryRestaurantBidsDto,
} from '@shared/v1/dto';

import { RestaurantsRepository } from './restaurants.repository';
import { GooglePlacesService } from '../../core/google-places/google-places.service';
import { PaymentService } from '../../core/payment/payment.service';
import { StorageService } from '../../core/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly repo: RestaurantsRepository,
    private readonly googlePlaces: GooglePlacesService,
    private readonly payment: PaymentService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                    GET /v1/restaurants                             */
  /* ------------------------------------------------------------------ */
  async findRestaurantsWithBidTotals(dto: QueryRestaurantsDto) {
    this.logger.debug(
      'FindRestaurantsWithBidTotals',
      'findRestaurantsWithBidTotals',
      {
        lat: dto.lat,
        lng: dto.lng,
        radius: dto.radius,
        cursor: dto.cursor,
      },
    );

    const items = await this.repo.findRestaurantsWithBidTotals(dto);

    this.logger.debug(
      'FindRestaurantsWithBidTotalsResult',
      'findRestaurantsWithBidTotals',
      {
        count: items.length,
      },
    );

    return items;
  }

  /* ------------------------------------------------------------------ */
  /*                    POST /v1/restaurants                            */
  /* ------------------------------------------------------------------ */
  async createRestaurant(dto: CreateRestaurantDto) {
    this.logger.debug('CreateRestaurant', 'createRestaurant', {
      googlePlaceId: dto.googlePlaceId,
    });

    // 既存チェック
    const existing = await this.repo.findRestaurantByGooglePlaceId(
      dto.googlePlaceId,
    );
    if (existing) {
      this.logger.debug('RestaurantExists', 'createRestaurant', {
        restaurantId: existing.id,
        googlePlaceId: dto.googlePlaceId,
      });
      return existing;
    }

    // Google Places API で詳細取得
    const placeDetail = await this.googlePlaces.getPlaceDetail(
      dto.googlePlaceId,
    );
    if (!placeDetail) {
      this.logger.warn('GooglePlaceNotFound', 'createRestaurant', {
        googlePlaceId: dto.googlePlaceId,
      });
      throw new NotFoundException('Google Place not found');
    }

    // レストラン作成
    const location = this.googlePlaces.createLocationGeography(
      placeDetail.geometry.location.lat,
      placeDetail.geometry.location.lng,
    );

    const imageUrl = placeDetail.photos?.[0]
      ? this.googlePlaces.getPhotoUrl(placeDetail.photos[0].photo_reference)
      : undefined;

    const restaurant = await this.repo.createRestaurant({
      googlePlaceId: dto.googlePlaceId,
      name: placeDetail.name,
      location: Prisma.sql`ST_GeogFromText(${location})`,
      imageUrl,
    });

    this.logger.log('RestaurantCreated', 'createRestaurant', {
      restaurantId: restaurant.id,
      name: placeDetail.name,
    });

    return restaurant;
  }

  /* ------------------------------------------------------------------ */
  /*                    GET /v1/restaurants/:id                         */
  /* ------------------------------------------------------------------ */
  async findRestaurantById(id: string) {
    this.logger.debug('FindRestaurantById', 'findRestaurantById', {
      id,
    });

    const restaurant = await this.repo.findRestaurantById(id);
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    return restaurant;
  }

  /* ------------------------------------------------------------------ */
  /*             POST /v1/restaurants/:id/bids/intents                  */
  /* ------------------------------------------------------------------ */
  async createRestaurantBidIntent(
    restaurantId: string,
    dto: CreateRestaurantBidIntentDto,
  ) {
    this.logger.debug(
      'CreateRestaurantBidIntent',
      'createRestaurantBidIntent',
      {
        restaurantId,
        amountCents: dto.amountCents,
      },
    );

    // レストラン存在確認
    const restaurant = await this.repo.findRestaurantById(restaurantId);
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    // PaymentIntent 作成
    const { clientSecret } = await this.payment.createPaymentIntent(
      dto.amountCents,
    );

    this.logger.log('RestaurantBidIntentCreated', 'createRestaurantBidIntent', {
      restaurantId,
      amountCents: dto.amountCents,
    });

    return { clientSecret };
  }

  /* ------------------------------------------------------------------ */
  /*               GET /v1/restaurants/:id/dish-media                   */
  /* ------------------------------------------------------------------ */
  async findRestaurantDishMedia(
    restaurantId: string,
    dto: QueryRestaurantDishMediaDto,
  ) {
    this.logger.debug('FindRestaurantDishMedia', 'findRestaurantDishMedia', {
      restaurantId,
      cursor: dto.cursor,
    });

    const items = await this.repo.findRestaurantDishMedia(restaurantId, dto);

    // 署名付きURL を付与
    const withSignedUrls = await Promise.all(
      items.map(async (item) => {
        const signedUrl = await this.storage.generateSignedUrl(
          item.dish_media.media_path,
        );
        return {
          ...item,
          dish_media: {
            ...item.dish_media,
            media_url: signedUrl,
          },
        };
      }),
    );

    this.logger.debug(
      'FindRestaurantDishMediaResult',
      'findRestaurantDishMedia',
      {
        count: withSignedUrls.length,
      },
    );

    return withSignedUrls;
  }

  /* ------------------------------------------------------------------ */
  /*            GET /v1/restaurants/:id/restaurant-bids                 */
  /* ------------------------------------------------------------------ */
  async findRestaurantBids(restaurantId: string, dto: QueryRestaurantBidsDto) {
    this.logger.debug('FindRestaurantBids', 'findRestaurantBids', {
      restaurantId,
      cursor: dto.cursor,
    });

    const bids = await this.repo.findRestaurantBids(restaurantId, dto);

    this.logger.debug('FindRestaurantBidsResult', 'findRestaurantBids', {
      count: bids.length,
    });

    return bids;
  }
}

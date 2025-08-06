// api/src/v1/restaurants/restaurants.service.ts
//
// ❶ Controller から渡される DTO を受け取り Repository・Storage・External API を編成
// ❂ 1 メソッド = 1 ユースケース（トランザクション／ロギング込み）
// ❸ "副作用" は出来るだけ Service で完結させ、Controller は薄く保つ
//

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';

import {
  QueryRestaurantsDto,
  CreateRestaurantDto,
  CreateRestaurantBidIntentDto,
  QueryRestaurantDishMediaDto,
  QueryRestaurantBidsDto,
} from '@shared/v1/dto';

import { RestaurantsRepository } from './restaurants.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { ExternalApiService } from '../../core/external-api/external-api.service';

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly repo: RestaurantsRepository,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly externalApi: ExternalApiService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                     GET /v1/restaurants                            */
  /* ------------------------------------------------------------------ */
  async findRestaurantsNearby(dto: QueryRestaurantsDto, viewerId?: string): Promise<any[]> {
    this.logger.debug('FindRestaurantsNearby', 'findRestaurantsNearby', {
      lat: dto.lat,
      lng: dto.lng,
      radius: dto.radius,
      cursor: dto.cursor,
      viewer: viewerId ?? 'anon',
    });

    const records = await this.repo.findRestaurantsWithBidTotals(dto);

    this.logger.debug('FindRestaurantsNearbyResult', 'findRestaurantsNearby', {
      count: records.length,
    });
    
    return records;
  }

  /* ------------------------------------------------------------------ */
  /*                     POST /v1/restaurants                           */
  /* ------------------------------------------------------------------ */
  async createRestaurant(dto: CreateRestaurantDto) {
    this.logger.debug('CreateRestaurant', 'createRestaurant', {
      googlePlaceId: dto.googlePlaceId,
    });

    // Check if restaurant already exists
    const existingRestaurant = await this.repo.findByGooglePlaceId(dto.googlePlaceId);
    if (existingRestaurant) {
      this.logger.debug('RestaurantExists', 'createRestaurant', {
        existingId: existingRestaurant.id,
      });
      return existingRestaurant;
    }

    // Fetch place details from Google Places API
    const placeDetail = await this.fetchGooglePlaceDetail(dto.googlePlaceId);
    
    // Create restaurant in transaction
    const result = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.createRestaurant(tx, {
          google_place_id: dto.googlePlaceId,
          name: placeDetail.name,
          location: `${placeDetail.lng} ${placeDetail.lat}`,
          image_url: placeDetail.image_url,
        }),
    );

    this.logger.log('RestaurantCreated', 'createRestaurant', {
      restaurantId: result.id,
      googlePlaceId: dto.googlePlaceId,
    });

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*              POST /v1/restaurants/:id/bids/intents                 */
  /* ------------------------------------------------------------------ */
  async createBidIntent(restaurantId: string, dto: CreateRestaurantBidIntentDto, userId: string) {
    this.logger.debug('CreateBidIntent', 'createBidIntent', {
      restaurantId,
      amountCents: dto.amountCents,
      userId,
    });

    // Validate restaurant exists
    const restaurantExists = await this.repo.restaurantExists(restaurantId);
    if (!restaurantExists) {
      this.logger.warn('RestaurantNotFound', 'createBidIntent', {
        restaurantId,
      });
      throw new NotFoundException('Restaurant not found');
    }

    // Create payment intent via external payment service
    const paymentIntent = await this.createPaymentIntent(dto.amountCents);

    this.logger.log('BidIntentCreated', 'createBidIntent', {
      restaurantId,
      intentId: paymentIntent.intentId,
      amountCents: dto.amountCents,
    });

    return { clientSecret: paymentIntent.clientSecret };
  }

  /* ------------------------------------------------------------------ */
  /*              GET /v1/restaurants/:id/dish-media                    */
  /* ------------------------------------------------------------------ */
  async findRestaurantDishMedia(restaurantId: string, dto: QueryRestaurantDishMediaDto, viewerId?: string): Promise<any[]> {
    this.logger.debug('FindRestaurantDishMedia', 'findRestaurantDishMedia', {
      restaurantId,
      cursor: dto.cursor,
      viewer: viewerId ?? 'anon',
    });

    const records = await this.repo.findRestaurantDishMedia(restaurantId, dto.cursor);

    this.logger.debug('FindRestaurantDishMediaResult', 'findRestaurantDishMedia', {
      count: records.length,
    });

    return records;
  }

  /* ------------------------------------------------------------------ */
  /*              GET /v1/restaurants/:id/restaurant-bids               */
  /* ------------------------------------------------------------------ */
  async findRestaurantBids(restaurantId: string, dto: QueryRestaurantBidsDto) {
    this.logger.debug('FindRestaurantBids', 'findRestaurantBids', {
      restaurantId,
      cursor: dto.cursor,
    });

    const records = await this.repo.findRestaurantBids(restaurantId, dto.cursor);

    this.logger.debug('FindRestaurantBidsResult', 'findRestaurantBids', {
      count: records.length,
    });

    return records;
  }

  /* ------------------------------------------------------------------ */
  /*                    GET /v1/restaurants/:id                         */
  /* ------------------------------------------------------------------ */
  async findRestaurantById(id: string) {
    this.logger.debug('FindRestaurantById', 'findRestaurantById', {
      restaurantId: id,
    });

    const restaurant = await this.repo.findRestaurantById(id);
    
    if (!restaurant) {
      this.logger.warn('RestaurantNotFound', 'findRestaurantById', {
        restaurantId: id,
      });
      throw new NotFoundException('Restaurant not found');
    }

    return restaurant;
  }

  /* ------------------------------------------------------------------ */
  /*                    Private Helper Methods                          */
  /* ------------------------------------------------------------------ */
  
  private async fetchGooglePlaceDetail(googlePlaceId: string) {
    this.logger.debug('FetchGooglePlaceDetail', 'fetchGooglePlaceDetail', {
      googlePlaceId,
    });

    try {
      // TODO: Implement actual Google Places API call
      // For now, return mock data to allow implementation to proceed
      const mockPlaceDetail = {
        name: `Restaurant ${googlePlaceId.slice(-8)}`,
        lat: 35.6762 + (Math.random() - 0.5) * 0.1, // Mock Tokyo area
        lng: 139.6503 + (Math.random() - 0.5) * 0.1,
        image_url: 'https://example.com/restaurant-image.jpg',
      };

      this.logger.debug('GooglePlaceDetailFetched', 'fetchGooglePlaceDetail', {
        placeDetail: mockPlaceDetail,
      });

      return mockPlaceDetail;
    } catch (error) {
      this.logger.error('GooglePlaceDetailError', 'fetchGooglePlaceDetail', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        googlePlaceId,
      });
      throw new BadRequestException('Failed to fetch place details from Google');
    }
  }

  private async createPaymentIntent(amountCents: number) {
    this.logger.debug('CreatePaymentIntent', 'createPaymentIntent', {
      amountCents,
    });

    try {
      // TODO: Implement actual payment service integration (Stripe, etc.)
      // For now, return mock data to allow implementation to proceed
      const mockPaymentIntent = {
        intentId: `pi_mock_${Date.now()}`,
        clientSecret: `pi_mock_${Date.now()}_secret_${Math.random().toString(36).substr(2, 9)}`,
      };

      this.logger.debug('PaymentIntentCreated', 'createPaymentIntent', {
        intentId: mockPaymentIntent.intentId,
        amountCents,
      });

      return mockPaymentIntent;
    } catch (error) {
      this.logger.error('PaymentIntentError', 'createPaymentIntent', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        amountCents,
      });
      throw new BadRequestException('Failed to create payment intent');
    }
  }
}
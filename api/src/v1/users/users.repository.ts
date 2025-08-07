// api/src/v1/users/users.repository.ts
//
// 🎯 目的
//   • Prisma を "1 つのデータ取得 API" として隠蔽し、Service から直アクセスさせない
//   • カーソル式ページネーション / JOIN取得 を 1 箇所に集約
//   • 返却は **ドメイン Entity** に近い形（型安全 & Service で再集計不要）
//

import { Injectable } from '@nestjs/common';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import { PrismaDishes } from '../../../../shared/converters/convert_dishes';
import { PrismaDishMedia } from '../../../../shared/converters/convert_dish_media';
import { PrismaDishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { PrismaPayouts } from '../../../../shared/converters/convert_payouts';
import { PrismaRestaurantBids } from '../../../../shared/converters/convert_restaurant_bids';
import { PrismaDishCategories } from '../../../../shared/converters/convert_dish_categories';

import { PrismaService } from '../../prisma/prisma.service';

/* -------------------------------------------------------------------------- */
/*                       返却型 (ドメイン Entity 例)                           */
/* -------------------------------------------------------------------------- */
export interface UserDishReviewItem {
  dish_media: PrismaDishMedia | null;
  dish_review: PrismaDishReviews;
  hasMedia: boolean;
}

export interface LikedDishMediaItem {
  restaurant: PrismaRestaurants;
  dish: PrismaDishes;
  dish_media: PrismaDishMedia;
  dish_reviews: PrismaDishReviews[];
}

export interface SavedDishMediaItem {
  restaurant: PrismaRestaurants;
  dish: PrismaDishes;
  dish_media: PrismaDishMedia;
  dish_reviews: PrismaDishReviews[];
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly PAGE_SIZE = 42;

  /* ------------------------------------------------------------------ */
  /*              GET /v1/users/:id/dish-reviews                       */
  /* ------------------------------------------------------------------ */
  async findUserDishReviews(
    userId: string,
    cursor?: string,
  ): Promise<UserDishReviewItem[]> {
    const whereClause: any = {
      user_id: userId,
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const records = await this.prisma.dish_reviews.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: this.PAGE_SIZE,
    });

    // Get dish_media for records that have created_dish_media_id
    const result = await Promise.all(
      records.map(async (record) => {
        let dishMedia: any = null;
        if (record.created_dish_media_id) {
          dishMedia = await this.prisma.dish_media.findUnique({
            where: { id: record.created_dish_media_id },
            select: {
              id: true,
              dish_id: true,
              user_id: true,
              media_path: true,
              media_type: true,
              thumbnail_path: true,
              created_at: true,
              updated_at: true,
              lock_no: true,
            },
          });
        }

        return {
          dish_media: dishMedia,
          dish_review: {
            id: record.id,
            dish_id: record.dish_id,
            comment: record.comment,
            user_id: record.user_id,
            rating: record.rating,
            price_cents: record.price_cents,
            currency_code: record.currency_code,
            created_dish_media_id: record.created_dish_media_id,
            imported_user_name: record.imported_user_name,
            imported_user_avatar: record.imported_user_avatar,
            created_at: record.created_at,
          },
          hasMedia: dishMedia !== null,
        };
      }),
    );

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*             GET /v1/users/me/liked-dish-media                      */
  /* ------------------------------------------------------------------ */
  async findMeLikedDishMedia(
    userId: string,
    cursor?: string,
  ): Promise<LikedDishMediaItem[]> {
    const whereClause: any = {
      user_id: userId,
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    // まず dish_likes から dish_media_id を取得
    const likedMedia = await this.prisma.dish_likes.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: this.PAGE_SIZE,
      select: {
        dish_media_id: true,
      },
    });

    if (likedMedia.length === 0) {
      return [];
    }

    const dishMediaIds = likedMedia.map((like) => like.dish_media_id);

    // dish_media とその関連データを取得
    const records = await this.prisma.dish_media.findMany({
      where: {
        id: {
          in: dishMediaIds,
        },
      },
      include: {
        dishes: {
          include: {
            restaurants: true,
          },
        },
      },
      orderBy: {
        id: 'asc',
      },
    });

    // Get dish_reviews for each dish
    const result = await Promise.all(
      records.map(async (record) => {
        const dishReviews = await this.prisma.dish_reviews.findMany({
          where: {
            dish_id: record.dish_id,
          },
          orderBy: {
            created_at: 'desc',
          },
          take: 10, // Limit reviews per dish
        });

        return {
          restaurant: record.dishes?.restaurants || {
            id: '',
            google_place_id: null,
            name: '',
            location: '',
            image_url: null,
            created_at: new Date(),
          },
          dish: record.dishes || {
            id: '',
            name: '',
            description: null,
            category_id: '',
            restaurant_id: null,
            created_at: new Date(),
            updated_at: new Date(),
            lock_no: 0,
          },
          dish_media: {
            id: record.id,
            dish_id: record.dish_id,
            user_id: record.user_id,
            media_path: record.media_path,
            media_type: record.media_type,
            thumbnail_path: record.thumbnail_path,
            created_at: record.created_at,
            updated_at: record.updated_at,
            lock_no: record.lock_no,
          },
          dish_reviews: dishReviews.map((review) => ({
            id: review.id,
            dish_id: review.dish_id,
            comment: review.comment,
            user_id: review.user_id,
            rating: review.rating,
            price_cents: review.price_cents,
            currency_code: review.currency_code,
            created_dish_media_id: review.created_dish_media_id,
            imported_user_name: review.imported_user_name,
            imported_user_avatar: review.imported_user_avatar,
            created_at: review.created_at,
          })),
        };
      }),
    );

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*                GET /v1/users/me/payouts                           */
  /* ------------------------------------------------------------------ */
  async findMePayouts(
    userId: string,
    cursor?: string,
  ): Promise<PrismaPayouts[]> {
    const whereClause: any = {
      restaurant_bids: {
        user_id: userId,
      },
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const records = await this.prisma.payouts.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: this.PAGE_SIZE,
    });

    return records.map((record) => ({
      id: record.id,
      bid_id: record.bid_id,
      transfer_id: record.transfer_id,
      dish_media_id: record.dish_media_id,
      amount_cents: record.amount_cents,
      currency_code: record.currency_code,
      status: record.status,
      created_at: record.created_at,
      updated_at: record.updated_at,
      lock_no: record.lock_no,
    }));
  }

  /* ------------------------------------------------------------------ */
  /*             GET /v1/users/me/restaurant-bids                      */
  /* ------------------------------------------------------------------ */
  async findMeRestaurantBids(
    userId: string,
    cursor?: string,
  ): Promise<PrismaRestaurantBids[]> {
    const whereClause: any = {
      user_id: userId,
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const records = await this.prisma.restaurant_bids.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: this.PAGE_SIZE,
    });

    return records.map((record) => ({
      id: record.id,
      restaurant_id: record.restaurant_id,
      user_id: record.user_id,
      payment_intent_id: record.payment_intent_id,
      amount_cents: record.amount_cents,
      currency_code: record.currency_code,
      start_date: record.start_date,
      end_date: record.end_date,
      status: record.status,
      refund_id: record.refund_id,
      created_at: record.created_at,
      updated_at: record.updated_at,
      lock_no: record.lock_no,
    }));
  }

  /* ------------------------------------------------------------------ */
  /*           GET /v1/users/me/saved-dish-categories                  */
  /* ------------------------------------------------------------------ */
  async findMeSavedDishCategories(
    userId: string,
    cursor?: string,
  ): Promise<PrismaDishCategories[]> {
    const whereClause: any = {
      user_id: userId,
      target_type: 'dish_category',
      action_type: 'save',
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    // まず reactions から dish_category_id を取得
    const savedCategories = await this.prisma.reactions.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: this.PAGE_SIZE,
      select: {
        target_id: true,
      },
    });

    if (savedCategories.length === 0) {
      return [];
    }

    const categoryIds = savedCategories.map((reaction) => reaction.target_id);

    // dish_categories を取得
    const records = await this.prisma.dish_categories.findMany({
      where: {
        id: {
          in: categoryIds,
        },
      },
      orderBy: {
        id: 'asc',
      },
    });

    return records.map((record) => ({
      id: record.id,
      label_en: record.label_en,
      labels: record.labels,
      image_url: record.image_url,
      origin: record.origin,
      cuisine: record.cuisine,
      tags: record.tags,
      created_at: record.created_at,
      updated_at: record.updated_at,
      lock_no: record.lock_no,
    }));
  }

  /* ------------------------------------------------------------------ */
  /*             GET /v1/users/me/saved-dish-media                     */
  /* ------------------------------------------------------------------ */
  async findMeSavedDishMedia(
    userId: string,
    cursor?: string,
  ): Promise<SavedDishMediaItem[]> {
    const whereClause: any = {
      user_id: userId,
      target_type: 'dish_media',
      action_type: 'save',
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    // まず reactions から dish_media_id を取得
    const savedMedia = await this.prisma.reactions.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: this.PAGE_SIZE,
      select: {
        target_id: true,
      },
    });

    if (savedMedia.length === 0) {
      return [];
    }

    const dishMediaIds = savedMedia.map((reaction) => reaction.target_id);

    // dish_media とその関連データを取得
    const records = await this.prisma.dish_media.findMany({
      where: {
        id: {
          in: dishMediaIds,
        },
      },
      include: {
        dishes: {
          include: {
            restaurants: true,
          },
        },
      },
      orderBy: {
        id: 'asc',
      },
    });

    // Get dish_reviews for each dish
    const result = await Promise.all(
      records.map(async (record) => {
        const dishReviews = await this.prisma.dish_reviews.findMany({
          where: {
            dish_id: record.dish_id,
          },
          orderBy: {
            created_at: 'desc',
          },
          take: 10, // Limit reviews per dish
        });

        return {
          restaurant: record.dishes?.restaurants || {
            id: '',
            google_place_id: null,
            name: '',
            location: '',
            image_url: null,
            created_at: new Date(),
          },
          dish: record.dishes || {
            id: '',
            name: '',
            description: null,
            category_id: '',
            restaurant_id: null,
            created_at: new Date(),
            updated_at: new Date(),
            lock_no: 0,
          },
          dish_media: {
            id: record.id,
            dish_id: record.dish_id,
            user_id: record.user_id,
            media_path: record.media_path,
            media_type: record.media_type,
            thumbnail_path: record.thumbnail_path,
            created_at: record.created_at,
            updated_at: record.updated_at,
            lock_no: record.lock_no,
          },
          dish_reviews: dishReviews.map((review) => ({
            id: review.id,
            dish_id: review.dish_id,
            comment: review.comment,
            user_id: review.user_id,
            rating: review.rating,
            price_cents: review.price_cents,
            currency_code: review.currency_code,
            created_dish_media_id: review.created_dish_media_id,
            imported_user_name: review.imported_user_name,
            imported_user_avatar: review.imported_user_avatar,
            created_at: review.created_at,
          })),
        };
      }),
    );

    return result;
  }
}

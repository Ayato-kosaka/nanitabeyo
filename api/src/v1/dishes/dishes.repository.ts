// api/src/v1/dishes/dishes.repository.ts
//
// Repository for dishes operations

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { PrismaDishes } from '../../../../shared/converters/convert_dishes';

import { CreateDishDto } from '@shared/v1/dto';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DishesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ------------------------------------------------------------------ */
  /*                   1) Create or get dish (upsert)                  */
  /* ------------------------------------------------------------------ */
  async createOrGetDish(dto: CreateDishDto): Promise<PrismaDishes> {
    // First try to find existing dish
    const existingDish = await this.prisma.dishes.findFirst({
      where: {
        restaurant_id: dto.restaurantId,
        category_id: dto.dishCategory,
      },
    });

    if (existingDish) {
      // Update existing dish
      return this.prisma.dishes.update({
        where: { id: existingDish.id },
        data: { updated_at: new Date() },
      });
    }

    // Create new dish
    return this.prisma.dishes.create({
      data: {
        restaurant_id: dto.restaurantId,
        category_id: dto.dishCategory,
        name: null, // Name will be set later based on category
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /*                   2) Check if restaurant exists                   */
  /* ------------------------------------------------------------------ */
  async restaurantExists(restaurantId: string): Promise<boolean> {
    const count = await this.prisma.restaurants.count({
      where: { id: restaurantId },
    });
    return count > 0;
  }

  /* ------------------------------------------------------------------ */
  /*                   3) Check if category exists                     */
  /* ------------------------------------------------------------------ */
  async categoryExists(categoryId: string): Promise<boolean> {
    const count = await this.prisma.dish_categories.count({
      where: { id: categoryId },
    });
    return count > 0;
  }

  /* ------------------------------------------------------------------ */
  /*                   4) Create restaurant from Google data           */
  /* ------------------------------------------------------------------ */
  async createRestaurant(
    tx: Prisma.TransactionClient,
    placeData: any,
  ): Promise<any> {
    return tx.restaurants.create({
      data: {
        google_place_id: placeData.place_id,
        name: placeData.name,
        location: `POINT(${placeData.geometry.location.lng} ${placeData.geometry.location.lat})`,
        image_url: placeData.photos?.[0]?.photo_reference 
          ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${placeData.photos[0].photo_reference}&key=${process.env.GOOGLE_API_KEY}`
          : null,
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /*                   5) Create dish from Google data                 */
  /* ------------------------------------------------------------------ */
  async createDish(
    tx: Prisma.TransactionClient,
    restaurantId: string,
    categoryId: string,
    dishName?: string,
  ): Promise<PrismaDishes> {
    return tx.dishes.create({
      data: {
        restaurant_id: restaurantId,
        category_id: categoryId,
        name: dishName,
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /*                   6) Create dish media from Google data           */
  /* ------------------------------------------------------------------ */
  async createDishMedia(
    tx: Prisma.TransactionClient,
    dishId: string,
    photoReference: string,
  ): Promise<any> {
    const mediaPath = `google_photos/${photoReference}`;
    
    return tx.dish_media.create({
      data: {
        dish_id: dishId,
        user_id: null, // Google imported, no specific user
        media_path: mediaPath,
        media_type: 'image',
        thumbnail_path: mediaPath,
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /*                   7) Create dish review from Google data          */
  /* ------------------------------------------------------------------ */
  async createDishReview(
    tx: Prisma.TransactionClient,
    dishId: string,
    review: any,
  ): Promise<any> {
    return tx.dish_reviews.create({
      data: {
        dish_id: dishId,
        user_id: null, // Google imported, no specific user
        comment: review.text || '',
        rating: review.rating || 5,
        price_cents: null,
        currency_code: null,
        created_dish_media_id: null,
        imported_user_name: review.author_name,
        imported_user_avatar: review.profile_photo_url,
      },
    });
  }
}
import { Test } from '@nestjs/testing';
import {
  DishMediaMapper,
  DishMediaEntryItem,
} from '../dish-media/dish-media.mapper';
import { UsersMapper } from '../users/users.mapper';

describe('Mapper Integration - Response Size Validation', () => {
  let dishMediaMapper: DishMediaMapper;
  let usersMapper: UsersMapper;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [DishMediaMapper, UsersMapper],
    }).compile();

    dishMediaMapper = module.get<DishMediaMapper>(DishMediaMapper);
    usersMapper = module.get<UsersMapper>(UsersMapper);
  });

  it('should produce smaller responses without unwanted fields', () => {
    // Create base data first
    const baseItem: DishMediaEntryItem = {
      restaurant: {
        id: 'restaurant-1',
        name: 'Test Restaurant',
        google_place_id: 'place-123',
        location: null,
        created_at: new Date('2023-01-01T00:00:00Z'),
        updated_at: new Date('2023-01-01T00:00:00Z'),
        lock_no: 1,
      } as any,
      dish: {
        id: 'dish-1',
        restaurant_id: 'restaurant-1',
        category_id: 'category-1',
        name: 'Test Dish',
        created_at: new Date('2023-01-01T00:00:00Z'),
        updated_at: new Date('2023-01-01T00:00:00Z'),
        lock_no: 1,
        reviewCount: 5,
        averageRating: 4.2,
      } as any,
      dish_media: {
        id: 'media-1',
        dish_id: 'dish-1',
        user_id: 'user-1',
        media_path: '/path/to/media',
        media_type: 'image',
        thumbnail_path: '/path/to/thumbnail',
        created_at: new Date('2023-01-01T00:00:00Z'),
        updated_at: new Date('2023-01-01T00:00:00Z'),
        lock_no: 1,
        isSaved: true,
        isLiked: false,
        likeCount: 10,
        mediaUrl: 'https://example.com/media.jpg',
        thumbnailImageUrl: 'https://example.com/thumb.jpg',
      },
      dish_reviews: [
        {
          id: 'review-1',
          dish_id: 'dish-1',
          comment: 'Great dish!',
          original_language_code: 'en',
          user_id: 'user-1',
          rating: 5,
          price_cents: 1000,
          currency_code: 'JPY',
          created_dish_media_id: 'media-1',
          imported_user_name: null,
          imported_user_avatar: null,
          created_at: new Date('2023-01-01T00:00:00Z'),
          username: 'testuser',
          isLiked: true,
          likeCount: 3,
        } as any,
      ],
    };

    // Add extra fields that would have been spread by the old implementation
    (baseItem.restaurant as any).extra_field_1 = 'unwanted data';
    (baseItem.restaurant as any).extra_field_2 = 'more unwanted data';
    (baseItem.restaurant as any).extra_field_3 = { nested: 'unwanted object' };
    (baseItem.dish as any).internal_notes = 'admin only notes';
    (baseItem.dish as any).debug_info = { verbose: 'data' };
    (baseItem.dish as any).temp_cache = 'cache data';
    (baseItem.dish_media as any).processing_status = 'completed';
    (baseItem.dish_media as any).metadata = {
      camera: 'iPhone',
      location: 'Tokyo',
    };
    (baseItem.dish_media as any).storage_info = 'internal data';
    (baseItem.dish_reviews[0] as any).moderation_status = 'approved';
    (baseItem.dish_reviews[0] as any).sentiment_score = 0.85;
    (baseItem.dish_reviews[0] as any).language_detection = 'en';

    const result = dishMediaMapper.toQueryDishMediaResponse([baseItem]);
    const entry = result[0];

    // Verify ONLY the expected fields are present (no extras)
    const restaurantKeys = Object.keys(entry.restaurant);
    const expectedRestaurantKeys = [
      'id',
      'google_place_id',
      'name',
      'name_language_code',
      'latitude',
      'longitude',
      'location',
      'image_url',
      'created_at',
    ];
    expect(restaurantKeys.sort()).toEqual(expectedRestaurantKeys.sort());

    const dishKeys = Object.keys(entry.dish);
    const expectedDishKeys = [
      'id',
      'restaurant_id',
      'category_id',
      'name',
      'created_at',
      'updated_at',
      'lock_no',
      'reviewCount',
      'averageRating',
    ];
    expect(dishKeys.sort()).toEqual(expectedDishKeys.sort());

    const dishMediaKeys = Object.keys(entry.dish_media);
    const expectedDishMediaKeys = [
      'id',
      'dish_id',
      'user_id',
      'media_path',
      'media_type',
      'thumbnail_path',
      'created_at',
      'updated_at',
      'lock_no',
      'isSaved',
      'isLiked',
      'likeCount',
      'mediaUrl',
      'thumbnailImageUrl',
    ];
    expect(dishMediaKeys.sort()).toEqual(expectedDishMediaKeys.sort());

    const reviewKeys = Object.keys(entry.dish_reviews[0]);
    const expectedReviewKeys = [
      'id',
      'dish_id',
      'comment',
      'comment_tsv',
      'original_language_code',
      'user_id',
      'rating',
      'price_cents',
      'currency_code',
      'created_dish_media_id',
      'imported_user_name',
      'imported_user_avatar',
      'created_at',
      'username',
      'isLiked',
      'likeCount',
    ];
    expect(reviewKeys.sort()).toEqual(expectedReviewKeys.sort());

    // Verify unwanted fields are NOT present
    expect(entry.restaurant).not.toHaveProperty('extra_field_1');
    expect(entry.restaurant).not.toHaveProperty('extra_field_2');
    expect(entry.restaurant).not.toHaveProperty('extra_field_3');
    expect(entry.dish).not.toHaveProperty('internal_notes');
    expect(entry.dish).not.toHaveProperty('debug_info');
    expect(entry.dish).not.toHaveProperty('temp_cache');
    expect(entry.dish_media).not.toHaveProperty('processing_status');
    expect(entry.dish_media).not.toHaveProperty('metadata');
    expect(entry.dish_media).not.toHaveProperty('storage_info');
    expect(entry.dish_reviews[0]).not.toHaveProperty('moderation_status');
    expect(entry.dish_reviews[0]).not.toHaveProperty('sentiment_score');
    expect(entry.dish_reviews[0]).not.toHaveProperty('language_detection');
  });

  it('should ensure users mapper produces same clean results', () => {
    const baseItem: DishMediaEntryItem = {
      restaurant: {
        id: 'restaurant-1',
        name: 'Test Restaurant',
        google_place_id: 'place-123',
        location: null,
        created_at: new Date('2023-01-01T00:00:00Z'),
        updated_at: new Date('2023-01-01T00:00:00Z'),
        lock_no: 1,
      } as any,
      dish: {
        id: 'dish-1',
        restaurant_id: 'restaurant-1',
        category_id: 'category-1',
        name: 'Test Dish',
        created_at: new Date('2023-01-01T00:00:00Z'),
        updated_at: new Date('2023-01-01T00:00:00Z'),
        lock_no: 1,
        reviewCount: 5,
        averageRating: 4.2,
      } as any,
      dish_media: {
        id: 'media-1',
        dish_id: 'dish-1',
        user_id: 'user-1',
        media_path: '/path/to/media',
        media_type: 'image',
        thumbnail_path: '/path/to/thumbnail',
        created_at: new Date('2023-01-01T00:00:00Z'),
        updated_at: new Date('2023-01-01T00:00:00Z'),
        lock_no: 1,
        isSaved: true,
        isLiked: false,
        likeCount: 10,
        mediaUrl: 'https://example.com/media.jpg',
        thumbnailImageUrl: 'https://example.com/thumb.jpg',
      },
      dish_reviews: [
        {
          id: 'review-1',
          dish_id: 'dish-1',
          comment: 'Great dish!',
          original_language_code: 'en',
          user_id: 'user-1',
          rating: 5,
          price_cents: 1000,
          currency_code: 'JPY',
          created_dish_media_id: 'media-1',
          imported_user_name: null,
          imported_user_avatar: null,
          created_at: new Date('2023-01-01T00:00:00Z'),
          username: 'testuser',
          isLiked: true,
          likeCount: 3,
        } as any,
      ],
    };

    // Add unwanted fields that would have been spread by the old implementation
    (baseItem.restaurant as any).unwanted_field = 'should not appear';
    (baseItem.dish as any).secret_data = 'confidential';
    (baseItem.dish_media as any).admin_data = 'not for API';
    (baseItem.dish_reviews[0] as any).private_notes = 'internal only';

    const result = usersMapper.toMeLikedDishMediaResponse({
      data: [baseItem],
      nextCursor: null,
    });

    const entry = result.data[0];

    // Verify unwanted fields are NOT present in any users mapper response
    expect(entry.restaurant).not.toHaveProperty('unwanted_field');
    expect(entry.dish).not.toHaveProperty('secret_data');
    expect(entry.dish_media).not.toHaveProperty('admin_data');
    expect(entry.dish_reviews[0]).not.toHaveProperty('private_notes');

    // Verify required fields are still present
    expect(entry.dish).toHaveProperty('reviewCount', 5);
    expect(entry.dish).toHaveProperty('averageRating', 4.2);
    expect(entry.dish_media).toHaveProperty('isSaved', true);
    expect(entry.dish_media).toHaveProperty('mediaUrl');
    expect(entry.dish_reviews[0]).toHaveProperty('username', 'testuser');
  });
});

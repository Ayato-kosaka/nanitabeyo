import { Test } from '@nestjs/testing';
import { DishMediaMapper, DishMediaEntryItem } from './dish-media.mapper';

describe('DishMediaMapper', () => {
  let mapper: DishMediaMapper;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [DishMediaMapper],
    }).compile();

    mapper = module.get<DishMediaMapper>(DishMediaMapper);
  });

  describe('toSearchDishMediaResponse', () => {
    it('should map correctly without spreading unwanted fields', () => {
      // Create mock data that simulates what repository provides
      const mockItem: DishMediaEntryItem = {
        restaurant: {
          id: 'restaurant-1',
          name: 'Test Restaurant',
          google_place_id: 'place-123',
          location: null,
          created_at: new Date('2023-01-01T00:00:00Z'),
          updated_at: new Date('2023-01-01T00:00:00Z'),
          lock_no: 1,
        } as any, // Add extra fields via any to simulate unwanted data
        dish: {
          id: 'dish-1',
          restaurant_id: 'restaurant-1',
          category_id: 'category-1',
          name: 'Test Dish',
          created_at: new Date('2023-01-01T00:00:00Z'),
          updated_at: new Date('2023-01-01T00:00:00Z'),
          lock_no: 1,
          // Required additional fields
          reviewCount: 5,
          averageRating: 4.2,
        } as any, // Add extra fields via any to simulate unwanted data
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
          // Required additional fields
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
            // Required additional fields
            username: 'testuser',
            isLiked: true,
            likeCount: 3,
          } as any, // Add extra fields via any to simulate unwanted data
        ],
      };

      // Add unwanted fields after creation to simulate data from repository
      (mockItem.restaurant as any).internal_field = 'should-not-appear';
      (mockItem.dish as any).secret_field = 'should-not-appear';
      (mockItem.dish_media as any).private_field = 'should-not-appear';
      (mockItem.dish_reviews[0] as any).admin_notes = 'should-not-appear';

      const result = mapper.toSearchDishMediaResponse([mockItem]);

      expect(result).toHaveLength(1);
      const entry = result[0];

      // Verify restaurant mapping - should only have converted fields
      expect(entry.restaurant).toEqual({
        id: 'restaurant-1',
        name: 'Test Restaurant',
        google_place_id: 'place-123',
        name_language_code: undefined,
        latitude: undefined,
        longitude: undefined,
        location: null,
        image_url: undefined,
        created_at: '2023-01-01T00:00:00.000Z',
      });
      expect(entry.restaurant).not.toHaveProperty('internal_field');
      expect(entry.restaurant).not.toHaveProperty('updated_at'); // This should not be in SupabaseRestaurants
      expect(entry.restaurant).not.toHaveProperty('lock_no'); // This should not be in SupabaseRestaurants

      // Verify dish mapping - should have converted fields + required additional fields
      expect(entry.dish).toEqual({
        id: 'dish-1',
        restaurant_id: 'restaurant-1',
        category_id: 'category-1',
        name: 'Test Dish',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
        lock_no: 1,
        reviewCount: 5,
        averageRating: 4.2,
      });
      expect(entry.dish).not.toHaveProperty('secret_field');

      // Verify dish_media mapping - should have converted fields + required additional fields
      expect(entry.dish_media).toEqual({
        id: 'media-1',
        dish_id: 'dish-1',
        user_id: 'user-1',
        media_path: '/path/to/media',
        media_type: 'image',
        thumbnail_path: '/path/to/thumbnail',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
        lock_no: 1,
        isSaved: true,
        isLiked: false,
        likeCount: 10,
        mediaUrl: 'https://example.com/media.jpg',
        thumbnailImageUrl: 'https://example.com/thumb.jpg',
      });
      expect(entry.dish_media).not.toHaveProperty('private_field');

      // Verify dish_reviews mapping - should have converted fields + required additional fields
      expect(entry.dish_reviews).toHaveLength(1);
      expect(entry.dish_reviews[0]).toEqual({
        id: 'review-1',
        dish_id: 'dish-1',
        comment: 'Great dish!',
        comment_tsv: null,
        original_language_code: 'en',
        user_id: 'user-1',
        rating: 5,
        price_cents: 1000,
        currency_code: 'JPY',
        created_dish_media_id: 'media-1',
        imported_user_name: null,
        imported_user_avatar: null,
        created_at: '2023-01-01T00:00:00.000Z',
        username: 'testuser',
        isLiked: true,
        likeCount: 3,
      });
      expect(entry.dish_reviews[0]).not.toHaveProperty('admin_notes');
    });

    it('should handle empty arrays', () => {
      const result = mapper.toSearchDishMediaResponse([]);
      expect(result).toEqual([]);
    });
  });
});

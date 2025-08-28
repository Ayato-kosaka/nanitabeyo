import { Test } from '@nestjs/testing';
import { UsersMapper } from './users.mapper';
import { DishMediaEntryItem } from '../dish-media/dish-media.mapper';

describe('UsersMapper', () => {
  let mapper: UsersMapper;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [UsersMapper],
    }).compile();

    mapper = module.get<UsersMapper>(UsersMapper);
  });

  describe('toMeLikedDishMediaResponse', () => {
    it('should map correctly without spreading unwanted fields', () => {
      const mockItem: DishMediaEntryItem = {
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

      // Add unwanted fields after creation to simulate data from repository
      (mockItem.restaurant as any).internal_field = 'should-not-appear';
      (mockItem.dish as any).secret_field = 'should-not-appear';
      (mockItem.dish_media as any).private_field = 'should-not-appear';
      (mockItem.dish_reviews[0] as any).admin_notes = 'should-not-appear';

      const result = mapper.toMeLikedDishMediaResponse({
        data: [mockItem],
        nextCursor: 'next-cursor',
      });

      expect(result.nextCursor).toBe('next-cursor');
      expect(result.data).toHaveLength(1);

      const entry = result.data[0];

      // Verify no unwanted fields leak through
      expect(entry.restaurant).not.toHaveProperty('internal_field');
      expect(entry.dish).not.toHaveProperty('secret_field');
      expect(entry.dish_media).not.toHaveProperty('private_field');
      expect(entry.dish_reviews[0]).not.toHaveProperty('admin_notes');

      // Verify required fields are present
      expect(entry.dish).toHaveProperty('reviewCount', 5);
      expect(entry.dish).toHaveProperty('averageRating', 4.2);
      expect(entry.dish_media).toHaveProperty('isSaved', true);
      expect(entry.dish_media).toHaveProperty('isLiked', false);
      expect(entry.dish_media).toHaveProperty('likeCount', 10);
      expect(entry.dish_media).toHaveProperty('mediaUrl');
      expect(entry.dish_media).toHaveProperty('thumbnailImageUrl');
      expect(entry.dish_reviews[0]).toHaveProperty('username', 'testuser');
      expect(entry.dish_reviews[0]).toHaveProperty('isLiked', true);
      expect(entry.dish_reviews[0]).toHaveProperty('likeCount', 3);
    });
  });

  describe('toMeSavedDishMediaResponse', () => {
    it('should map correctly without spreading unwanted fields', () => {
      const mockItem: DishMediaEntryItem = {
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
          reviewCount: 3,
          averageRating: 4.5,
        } as any,
        dish_media: {
          id: 'media-2',
          dish_id: 'dish-1',
          user_id: 'user-2',
          media_path: '/path/to/media2',
          media_type: 'video',
          thumbnail_path: '/path/to/thumbnail2',
          created_at: new Date('2023-01-02T00:00:00Z'),
          updated_at: new Date('2023-01-02T00:00:00Z'),
          lock_no: 2,
          isSaved: false,
          isLiked: true,
          likeCount: 15,
          mediaUrl: 'https://example.com/media2.mp4',
          thumbnailImageUrl: 'https://example.com/thumb2.jpg',
        },
        dish_reviews: [],
      };

      // Add unwanted fields after creation to simulate data from repository
      (mockItem.restaurant as any).internal_field = 'should-not-appear';
      (mockItem.dish as any).secret_field = 'should-not-appear';
      (mockItem.dish_media as any).private_field = 'should-not-appear';

      const result = mapper.toMeSavedDishMediaResponse({
        data: [mockItem],
        nextCursor: null,
      });

      expect(result.nextCursor).toBeNull();
      expect(result.data).toHaveLength(1);

      const entry = result.data[0];

      // Verify no unwanted fields leak through
      expect(entry.restaurant).not.toHaveProperty('internal_field');
      expect(entry.dish).not.toHaveProperty('secret_field');
      expect(entry.dish_media).not.toHaveProperty('private_field');

      // Verify required fields are present
      expect(entry.dish).toHaveProperty('reviewCount', 3);
      expect(entry.dish).toHaveProperty('averageRating', 4.5);
      expect(entry.dish_media).toHaveProperty('isSaved', false);
      expect(entry.dish_media).toHaveProperty('isLiked', true);
      expect(entry.dish_media).toHaveProperty('likeCount', 15);
      expect(entry.dish_reviews).toEqual([]);
    });
  });

  describe('toUserDishReviewsResponse', () => {
    it('should map correctly with isMe field and without spreading unwanted fields', () => {
      const mockItem = {
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
          reviewCount: 2,
          averageRating: 3.5,
        } as any,
        dish_media: {
          id: 'media-3',
          dish_id: 'dish-1',
          user_id: 'user-3',
          media_path: '/path/to/media3',
          media_type: 'image',
          thumbnail_path: '/path/to/thumbnail3',
          created_at: new Date('2023-01-03T00:00:00Z'),
          updated_at: new Date('2023-01-03T00:00:00Z'),
          lock_no: 3,
          isSaved: true,
          isLiked: true,
          likeCount: 20,
          mediaUrl: 'https://example.com/media3.jpg',
          thumbnailImageUrl: 'https://example.com/thumb3.jpg',
          isMe: true, // Additional field for this specific response type
        },
        dish_reviews: [
          {
            id: 'review-2',
            dish_id: 'dish-1',
            comment: 'Nice!',
            original_language_code: 'ja',
            user_id: 'user-3',
            rating: 4,
            price_cents: 800,
            currency_code: 'JPY',
            created_dish_media_id: 'media-3',
            imported_user_name: null,
            imported_user_avatar: null,
            created_at: new Date('2023-01-03T00:00:00Z'),
            username: 'reviewer',
            isLiked: false,
            likeCount: 1,
          } as any,
        ],
      };

      // Add unwanted fields after creation to simulate data from repository
      (mockItem.restaurant as any).internal_field = 'should-not-appear';
      (mockItem.dish as any).secret_field = 'should-not-appear';
      (mockItem.dish_media as any).private_field = 'should-not-appear';
      (mockItem.dish_reviews[0] as any).admin_notes = 'should-not-appear';

      const result = mapper.toUserDishReviewsResponse({
        data: [mockItem],
        nextCursor: 'user-reviews-cursor',
      });

      expect(result.nextCursor).toBe('user-reviews-cursor');
      expect(result.data).toHaveLength(1);

      const entry = result.data[0];

      // Verify no unwanted fields leak through
      expect(entry.restaurant).not.toHaveProperty('internal_field');
      expect(entry.dish).not.toHaveProperty('secret_field');
      expect(entry.dish_media).not.toHaveProperty('private_field');
      expect(entry.dish_reviews[0]).not.toHaveProperty('admin_notes');

      // Verify required fields are present, including isMe
      expect(entry.dish_media).toHaveProperty('isMe', true);
    });
  });
});

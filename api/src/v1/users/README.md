# Users Module Implementation

This document describes the implementation of the users module endpoints as specified in issue #66.

## Implemented Endpoints

### 1. GET `/v1/users/{id}/dish-reviews`
- **Purpose**: レビューした料理投稿一覧 (User's dish reviews)
- **Auth**: OptionalJwtAuthGuard
- **Query Params**: `cursor` (optional)
- **Response**: Array of `{DishMedia, DishReviews, signedUrls, hasMedia}`

**Example URL**: `GET /v1/users/550e8400-e29b-41d4-a716-446655440000/dish-reviews?cursor=2024-01-15T10:30:00Z`

### 2. GET `/v1/users/me/liked-dish-media`
- **Purpose**: 自分がいいねした料理投稿一覧 (User's liked dish media)
- **Auth**: OptionalJwtAuthGuard
- **Query Params**: `cursor` (optional)
- **Response**: Array of `{Restaurants, Dishes, DishMedia, DishReviews[]}`

**Example URL**: `GET /v1/users/me/liked-dish-media?cursor=2024-01-15T10:30:00Z`

### 3. GET `/v1/users/me/payouts`
- **Purpose**: 自分の収益一覧 (User's payouts)
- **Auth**: JwtAuthGuard (required)
- **Query Params**: `cursor` (optional)
- **Response**: Array of `Payouts[]` with `nextCursor`

**Example URL**: `GET /v1/users/me/payouts?cursor=2024-01-15T10:30:00Z`

### 4. GET `/v1/users/me/restaurant-bids`
- **Purpose**: 自分の入札履歴一覧 (User's restaurant bid history)
- **Auth**: JwtAuthGuard (required)
- **Query Params**: `cursor` (optional)
- **Response**: Array of `RestaurantBids[]` with `nextCursor`

**Example URL**: `GET /v1/users/me/restaurant-bids?cursor=2024-01-15T10:30:00Z`

### 5. GET `/v1/users/me/saved-dish-categories`
- **Purpose**: 自分の保存カテゴリ一覧 (User's saved dish categories)
- **Auth**: OptionalJwtAuthGuard
- **Query Params**: `cursor` (optional)
- **Response**: Array of `DishCategories[]` with `nextCursor`

**Example URL**: `GET /v1/users/me/saved-dish-categories?cursor=2024-01-15T10:30:00Z`

### 6. GET `/v1/users/me/saved-dish-media`
- **Purpose**: 保存済み料理投稿一覧 (User's saved dish media)
- **Auth**: OptionalJwtAuthGuard
- **Query Params**: `cursor` (optional)
- **Response**: Array of `{Restaurants, Dishes, DishMedia, DishReviews[]}[]` with `nextCursor`

**Example URL**: `GET /v1/users/me/saved-dish-media?cursor=2024-01-15T10:30:00Z`

## Implementation Architecture

### 1. Module Structure
Following the established pattern from `dish-media` module:

```
api/src/v1/users/
├── users.module.ts       # NestJS module configuration
├── users.controller.ts   # HTTP endpoints and validation
├── users.service.ts      # Business logic and orchestration
├── users.repository.ts   # Database queries
└── users.mapper.ts       # Response type conversion
```

### 2. Authentication Guards
- **OptionalJwtAuthGuard**: Allows both authenticated and anonymous access
- **JwtAuthGuard**: Requires valid JWT token

### 3. Pagination
All endpoints support cursor-based pagination using the `cursor` query parameter:
- Cursor value is the `created_at` timestamp from the last item
- Limit is set to 42 items per page
- Returns `nextCursor` for pagination

### 4. Database Queries
The repository implements SQL queries following the sequence diagrams:

#### User Dish Reviews Query
```sql
SELECT dr.id, dr.dish_id, dr.rating, dr.comment, dr.created_at,
       dm.media_path, (dm.user_id = :userId) AS hasMedia
FROM dish_reviews dr
LEFT JOIN dish_media dm ON dr.dish_media_id = dm.id
WHERE dr.user_id = :userId
ORDER BY dr.created_at DESC
```

#### Liked Dish Media Query
```sql
-- Step 1: Get liked media IDs
SELECT dish_media_id FROM dish_likes 
WHERE user_id = :userId ORDER BY created_at DESC

-- Step 2: Get full media data with relations
SELECT r.*, d.*, dm.*, json_agg(dr.*) as dish_reviews
FROM dish_media dm
JOIN dishes d ON dm.dish_id = d.id  
JOIN restaurants r ON d.restaurant_id = r.id
LEFT JOIN dish_reviews dr ON dr.dish_id = d.id
WHERE dm.id = ANY(:mediaIds)
```

#### Saved Dish Categories Query
```sql
SELECT dc.* FROM dish_categories dc
JOIN reactions r ON dc.id = r.target_id
WHERE r.user_id = :userId 
  AND r.target_type = 'dish_category' 
  AND r.action_type = 'SAVE'
ORDER BY r.created_at DESC
```

### 5. Signed URL Generation
Media files get signed URLs generated for secure access:
- Uses `StorageService.generateSignedUrl()`
- 24-hour expiration as per specification
- Applied to `media_path` and `image_url` fields

### 6. Response Mapping
The mapper converts Prisma types to Supabase response types using shared converters:
- `convertPrismaToSupabase_Restaurants`
- `convertPrismaToSupabase_Dishes`
- `convertPrismaToSupabase_DishMedia`
- `convertPrismaToSupabase_DishReviews`
- `convertPrismaToSupabase_Payouts`
- `convertPrismaToSupabase_RestaurantBids`
- `convertPrismaToSupabase_DishCategories`

### 7. Logging
All operations are logged using `AppLoggerService` with structured logging:
- Debug level for method entry/exit
- Include relevant parameters (user ID, cursor, counts)
- Follow existing logging patterns

## Integration Points

### Shared DTOs and Response Types
All DTOs and response types already exist in the shared package:
- `shared/api/v1/dto/users/` - Request DTOs
- `shared/api/v1/res/users.response.ts` - Response types

### V1 Module Registration
The UsersModule is imported in `v1.module.ts` making all endpoints available under `/v1/users/`.

### Dependencies
The module depends on these core services:
- `PrismaService` - Database access
- `StorageService` - Signed URL generation  
- `AppLoggerService` - Structured logging
- `AuthModule` - JWT guards and user context

## Testing Considerations

To test these endpoints:

1. **Authentication**: 
   - `/payouts` and `/restaurant-bids` require valid JWT
   - Others work with or without JWT

2. **Database Setup**:
   - Requires tables: `dish_reviews`, `dish_media`, `dish_likes`, `reactions`, `payouts`, `restaurant_bids`
   - Sample data for testing pagination

3. **Storage Service**:
   - Mock `generateSignedUrl()` method for unit tests
   - Verify proper media path handling

4. **Sample Test Cases**:
   ```typescript
   // Test pagination
   GET /v1/users/me/liked-dish-media?cursor=2024-01-15T10:30:00Z
   
   // Test without auth (should return empty for "me" endpoints) 
   GET /v1/users/me/payouts  // Should return 401
   
   // Test with invalid cursor
   GET /v1/users/me/saved-dish-media?cursor=invalid
   ```

## Error Handling

The implementation handles:
- Invalid user IDs (404 responses)
- Missing authentication for required endpoints (401 responses) 
- Invalid cursor values (400 responses)
- Database connection issues (500 responses)

All errors follow the established API error format using the global exception filter.
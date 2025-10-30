import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('DishMedia Reaction and Impression (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Mock dish_media_id for testing (will be created in beforeAll if needed)
  const testDishMediaId = '00000000-0000-0000-0000-000000000001';
  const testUserId = '00000000-0000-0000-0000-000000000002';
  const testSessionId = 'test-session-id-123';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/dish-media/:id/reaction', () => {
    it('should require authentication', async () => {
      return request(app.getHttpServer())
        .post(`/v1/dish-media/${testDishMediaId}/reaction`)
        .send({ action_type: 'like' })
        .expect(401);
    });

    it('should validate action_type is required', async () => {
      return request(app.getHttpServer())
        .post(`/v1/dish-media/${testDishMediaId}/reaction`)
        .set('Authorization', 'Bearer mock-token')
        .send({})
        .expect(400);
    });

    it('should validate action_type is one of allowed values', async () => {
      return request(app.getHttpServer())
        .post(`/v1/dish-media/${testDishMediaId}/reaction`)
        .set('Authorization', 'Bearer mock-token')
        .send({ action_type: 'invalid_action' })
        .expect(400);
    });

    it('should validate UUID format for dish_media_id', async () => {
      return request(app.getHttpServer())
        .post('/v1/dish-media/invalid-uuid/reaction')
        .set('Authorization', 'Bearer mock-token')
        .send({ action_type: 'like' })
        .expect(400);
    });

    // Integration tests would require proper JWT tokens and database setup
    // These are documented but skipped for now
    it.skip('should add a like reaction for authenticated user', async () => {
      // Would test:
      // 1. POST with action_type: 'like' and valid JWT
      // 2. Verify dish_media_likes row is created
      // 3. Verify analysis_results.like_total is incremented
      // 4. Verify idempotency (second POST doesn't increment again)
    });

    it.skip('should add a like reaction for anonymous user', async () => {
      // Would test:
      // 1. POST with action_type: 'like' and anonymous JWT
      // 2. Verify reactions row is created
      // 3. Verify analysis_results.like_total is incremented
      // 4. Verify idempotency
    });

    it.skip('should add a save reaction', async () => {
      // Would test:
      // 1. POST with action_type: 'save' and valid JWT
      // 2. Verify reactions row is created
      // 3. Verify analysis_results.save_total is incremented
      // 4. Verify idempotency
    });

    it.skip('should add an open_map reaction', async () => {
      // Would test:
      // 1. POST with action_type: 'open_map' and valid JWT
      // 2. Verify reactions row is created
      // 3. Verify analysis_results.open_map_total is incremented
      // 4. Verify idempotency
    });
  });

  describe('DELETE /v1/dish-media/:id/reaction', () => {
    it('should require authentication', async () => {
      return request(app.getHttpServer())
        .delete(`/v1/dish-media/${testDishMediaId}/reaction`)
        .send({ action_type: 'like' })
        .expect(401);
    });

    it('should validate action_type is required', async () => {
      return request(app.getHttpServer())
        .delete(`/v1/dish-media/${testDishMediaId}/reaction`)
        .set('Authorization', 'Bearer mock-token')
        .send({})
        .expect(400);
    });

    it('should validate UUID format for dish_media_id', async () => {
      return request(app.getHttpServer())
        .delete('/v1/dish-media/invalid-uuid/reaction')
        .set('Authorization', 'Bearer mock-token')
        .send({ action_type: 'like' })
        .expect(400);
    });

    it.skip('should remove a like reaction for authenticated user', async () => {
      // Would test:
      // 1. DELETE with action_type: 'like' and valid JWT
      // 2. Verify dish_media_likes row is deleted
      // 3. Verify analysis_results.like_total is decremented
      // 4. Verify idempotency (second DELETE doesn't decrement again)
    });

    it.skip('should remove a like reaction for anonymous user', async () => {
      // Would test:
      // 1. DELETE with action_type: 'like' and anonymous JWT
      // 2. Verify reactions row is deleted
      // 3. Verify analysis_results.like_total is decremented
      // 4. Verify idempotency
    });
  });

  describe('POST /v1/dish-media/:id/impression', () => {
    it('should require authentication', async () => {
      return request(app.getHttpServer())
        .post(`/v1/dish-media/${testDishMediaId}/impression`)
        .send({ session_id: testSessionId, source: 'feed' })
        .expect(401);
    });

    it('should validate session_id is required', async () => {
      return request(app.getHttpServer())
        .post(`/v1/dish-media/${testDishMediaId}/impression`)
        .set('Authorization', 'Bearer mock-token')
        .send({ source: 'feed' })
        .expect(400);
    });

    it('should validate source is required', async () => {
      return request(app.getHttpServer())
        .post(`/v1/dish-media/${testDishMediaId}/impression`)
        .set('Authorization', 'Bearer mock-token')
        .send({ session_id: testSessionId })
        .expect(400);
    });

    it('should validate UUID format for dish_media_id', async () => {
      return request(app.getHttpServer())
        .post('/v1/dish-media/invalid-uuid/impression')
        .set('Authorization', 'Bearer mock-token')
        .send({ session_id: testSessionId, source: 'feed' })
        .expect(400);
    });

    it.skip('should add an impression', async () => {
      // Would test:
      // 1. POST with session_id and source
      // 2. Verify dish_media_impressions row is created
      // 3. Verify analysis_results.impr_total is incremented
      // 4. Verify idempotency (same session_id doesn't increment again)
    });
  });

  describe('DELETE /v1/dish-media/:id/impression', () => {
    it('should require authentication', async () => {
      return request(app.getHttpServer())
        .delete(`/v1/dish-media/${testDishMediaId}/impression`)
        .send({ session_id: testSessionId, source: 'feed' })
        .expect(401);
    });

    it('should validate session_id is required', async () => {
      return request(app.getHttpServer())
        .delete(`/v1/dish-media/${testDishMediaId}/impression`)
        .set('Authorization', 'Bearer mock-token')
        .send({ source: 'feed' })
        .expect(400);
    });

    it('should validate UUID format for dish_media_id', async () => {
      return request(app.getHttpServer())
        .delete('/v1/dish-media/invalid-uuid/impression')
        .set('Authorization', 'Bearer mock-token')
        .send({ session_id: testSessionId, source: 'feed' })
        .expect(400);
    });

    it.skip('should remove an impression', async () => {
      // Would test:
      // 1. DELETE with session_id
      // 2. Verify dish_media_impressions row is deleted
      // 3. Verify analysis_results.impr_total is decremented
      // 4. Verify idempotency (second DELETE doesn't decrement again)
    });
  });

  describe('Transaction safety', () => {
    it.skip('should rollback on failure', async () => {
      // Would test that if analysis_results update fails,
      // the reaction/impression insertion is also rolled back
    });

    it.skip('should handle concurrent requests correctly', async () => {
      // Would test multiple simultaneous POST requests
      // to verify no duplicate increments occur
    });
  });

  describe('Unique constraints', () => {
    it.skip('should prevent duplicate likes from same user', async () => {
      // Would test that posting like twice doesn't create duplicates
    });

    it.skip('should prevent duplicate impressions from same session', async () => {
      // Would test that posting impression twice with same session_id
      // doesn't create duplicates
    });
  });
});

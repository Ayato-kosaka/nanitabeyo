import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * E2E テスト: Contribution Tasks GET APIs
 *
 * #701 【設計】4つのGETエンドポイントの基本的な動作を確認
 * - GET /v1/contribution-tasks (自分の履歴)
 * - GET /v1/contribution-tasks/:id (詳細)
 * - GET /v1/contribution-tasks/exists (二重防止)
 * - GET /v1/contribution-tasks/completed-target-ids (グローバル完了一覧)
 */
describe('ContributionTasks GET APIs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // テスト用のUUID
  const testUserId = '00000000-0000-0000-0000-000000000001';
  const testTargetId = '00000000-0000-0000-0000-000000000002';
  const testTaskId = '00000000-0000-0000-0000-000000000003';

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

  describe('GET /v1/contribution-tasks', () => {
    it('should require authentication', async () => {
      return request(app.getHttpServer())
        .get('/v1/contribution-tasks')
        .expect(401);
    });

    it.skip('should return empty list for user with no tasks', async () => {
      // #701 【設計】認証トークンが必要
      return request(app.getHttpServer())
        .get('/v1/contribution-tasks')
        .set('Authorization', 'Bearer mock-token')
        .expect(200)
        .expect((res) => {
          expect(res.body.items).toEqual([]);
          expect(res.body.nextCursor).toBeNull();
        });
    });

    it.skip('should filter by taskKey', async () => {
      // #701 【設計】taskKey でフィルタリングできる
      return request(app.getHttpServer())
        .get('/v1/contribution-tasks?taskKey=test_task')
        .set('Authorization', 'Bearer mock-token')
        .expect(200);
    });

    it.skip('should support pagination with cursor', async () => {
      // #701 【設計】カーソルページングができる
      return request(app.getHttpServer())
        .get('/v1/contribution-tasks?limit=10&cursor=test-cursor')
        .set('Authorization', 'Bearer mock-token')
        .expect(200);
    });

    it.skip('should include payload/result when requested', async () => {
      // #701 【設計】include=payload,result で含めることができる
      return request(app.getHttpServer())
        .get('/v1/contribution-tasks?include=payload,result')
        .set('Authorization', 'Bearer mock-token')
        .expect(200)
        .expect((res) => {
          if (res.body.items.length > 0) {
            expect(res.body.items[0]).toHaveProperty('payload');
            expect(res.body.items[0]).toHaveProperty('result');
          }
        });
    });
  });

  describe('GET /v1/contribution-tasks/:id', () => {
    it('should require authentication', async () => {
      return request(app.getHttpServer())
        .get(`/v1/contribution-tasks/${testTaskId}`)
        .expect(401);
    });

    it.skip('should return 404 for non-existent task', async () => {
      // #701 【設計】見つからないタスクは404
      return request(app.getHttpServer())
        .get(`/v1/contribution-tasks/${testTaskId}`)
        .set('Authorization', 'Bearer mock-token')
        .expect(404);
    });

    it.skip("should return 404 for other user's task", async () => {
      // #701 【設計】他人のタスクは404（認可チェック）
      return request(app.getHttpServer())
        .get(`/v1/contribution-tasks/${testTaskId}`)
        .set('Authorization', 'Bearer mock-token-other-user')
        .expect(404);
    });

    it.skip('should return task detail with payload and result', async () => {
      // #701 【設計】自分のタスクは詳細情報を取得できる
      return request(app.getHttpServer())
        .get(`/v1/contribution-tasks/${testTaskId}`)
        .set('Authorization', 'Bearer mock-token')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body).toHaveProperty('type');
          expect(res.body).toHaveProperty('taskKey');
          expect(res.body).toHaveProperty('targetType');
          expect(res.body).toHaveProperty('targetId');
          expect(res.body).toHaveProperty('payload');
          expect(res.body).toHaveProperty('result');
          expect(res.body).toHaveProperty('createdAt');
        });
    });
  });

  describe('GET /v1/contribution-tasks/exists', () => {
    it('should require authentication', async () => {
      return request(app.getHttpServer())
        .get('/v1/contribution-tasks/exists')
        .query({
          taskKey: 'test_task',
          targetType: 'dish',
          targetId: testTargetId,
        })
        .expect(401);
    });

    it('should validate required query parameters', async () => {
      return request(app.getHttpServer())
        .get('/v1/contribution-tasks/exists')
        .set('Authorization', 'Bearer mock-token')
        .expect(400);
    });

    it.skip('should return exists: false when task not completed', async () => {
      // #701 【設計】未完了の場合は exists: false
      return request(app.getHttpServer())
        .get('/v1/contribution-tasks/exists')
        .query({
          taskKey: 'test_task',
          targetType: 'dish',
          targetId: testTargetId,
        })
        .set('Authorization', 'Bearer mock-token')
        .expect(200)
        .expect((res) => {
          expect(res.body.exists).toBe(false);
          expect(res.body.id).toBeUndefined();
          expect(res.body.createdAt).toBeUndefined();
        });
    });

    it.skip('should return exists: true when task completed', async () => {
      // #701 【設計】完了済みの場合は exists: true と id, createdAt を返す
      return request(app.getHttpServer())
        .get('/v1/contribution-tasks/exists')
        .query({
          taskKey: 'test_task',
          targetType: 'dish',
          targetId: testTargetId,
        })
        .set('Authorization', 'Bearer mock-token')
        .expect(200)
        .expect((res) => {
          expect(res.body.exists).toBe(true);
          expect(res.body.id).toBeDefined();
          expect(res.body.createdAt).toBeDefined();
        });
    });

    it.skip('should filter by type when provided', async () => {
      // #701 【設計】type 指定時は type も一致する場合のみ true
      return request(app.getHttpServer())
        .get('/v1/contribution-tasks/exists')
        .query({
          taskKey: 'test_task',
          targetType: 'dish',
          targetId: testTargetId,
          type: 'image_feedback',
        })
        .set('Authorization', 'Bearer mock-token')
        .expect(200);
    });
  });

  describe('GET /v1/contribution-tasks/completed-target-ids', () => {
    it('should not require authentication (public endpoint)', async () => {
      // #701 【設計】認証不要（公開エンドポイント）
      return request(app.getHttpServer())
        .get('/v1/contribution-tasks/completed-target-ids')
        .query({
          taskKey: 'test_task',
          targetType: 'dish',
        })
        .expect(200);
    });

    it('should validate required query parameters', async () => {
      return request(app.getHttpServer())
        .get('/v1/contribution-tasks/completed-target-ids')
        .expect(400);
    });

    it.skip('should return aggregated completed target IDs', async () => {
      // #701 【設計】targetId と集計情報を返す
      return request(app.getHttpServer())
        .get('/v1/contribution-tasks/completed-target-ids')
        .query({
          taskKey: 'test_task',
          targetType: 'dish',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('taskKey');
          expect(res.body).toHaveProperty('targetType');
          expect(res.body).toHaveProperty('minCount');
          expect(res.body).toHaveProperty('completed');
          expect(res.body).toHaveProperty('nextCursor');
          expect(Array.isArray(res.body.completed)).toBe(true);
        });
    });

    it.skip('should not return user identifying information', async () => {
      // #701 【セキュリティ】個人特定情報を含まない
      return request(app.getHttpServer())
        .get('/v1/contribution-tasks/completed-target-ids')
        .query({
          taskKey: 'test_task',
          targetType: 'dish',
        })
        .expect(200)
        .expect((res) => {
          if (res.body.completed.length > 0) {
            const item = res.body.completed[0];
            expect(item).toHaveProperty('targetId');
            expect(item).toHaveProperty('count');
            expect(item).toHaveProperty('lastCompletedAt');
            // userId や個別レコードIDは含まれない
            expect(item).not.toHaveProperty('userId');
            expect(item).not.toHaveProperty('id');
          }
        });
    });

    it.skip('should filter by minCount', async () => {
      // #701 【設計】minCount で最小完了回数をフィルタできる
      return request(app.getHttpServer())
        .get('/v1/contribution-tasks/completed-target-ids')
        .query({
          taskKey: 'test_task',
          targetType: 'dish',
          minCount: 3,
        })
        .expect(200)
        .expect((res) => {
          // すべての item.count が minCount 以上であることを確認
          res.body.completed.forEach((item: any) => {
            expect(item.count).toBeGreaterThanOrEqual(3);
          });
        });
    });

    it.skip('should support pagination with cursor', async () => {
      // #701 【設計】カーソルページングができる
      return request(app.getHttpServer())
        .get('/v1/contribution-tasks/completed-target-ids')
        .query({
          taskKey: 'test_task',
          targetType: 'dish',
          limit: 10,
          cursor: 'test-cursor',
        })
        .expect(200);
    });
  });
});

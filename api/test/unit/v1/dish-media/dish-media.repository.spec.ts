import { Test, TestingModule } from '@nestjs/testing';
import { DishMediaRepository } from '../../../../src/v1/dish-media/dish-media.repository';
import { PrismaService } from '../../../../src/prisma/prisma.service';
import { AppLoggerService } from '../../../../src/core/logger/logger.service';

describe('DishMediaRepository - Reaction and Impression', () => {
  let repository: DishMediaRepository;
  let mockPrismaService: any;
  let mockLogger: any;

  const testDishMediaId = '00000000-0000-0000-0000-000000000001';
  const testUserId = '00000000-0000-0000-0000-000000000002';
  const testSessionId = 'test-session-123';

  beforeEach(async () => {
    // Create mock transaction client
    const mockTxClient = {
      reactions: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      dish_media_likes: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      dish_media_analysis_results: {
        update: jest.fn(),
      },
      dish_media_impressions: {
        findFirst: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    mockPrismaService = {
      prisma: mockTxClient,
      withTransaction: jest.fn((callback) => callback(mockTxClient)),
    };

    mockLogger = {
      debug: jest.fn(),
      verbose: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishMediaRepository,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: AppLoggerService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    repository = module.get<DishMediaRepository>(DishMediaRepository);
  });

  describe('addReaction', () => {
    it('should add like reaction for authenticated user to dish_media_likes', async () => {
      const mockTx = mockPrismaService.prisma;
      mockTx.dish_media_likes.upsert.mockResolvedValue({});
      mockTx.dish_media_analysis_results.update.mockResolvedValue({});

      await repository.addReaction(
        mockTx,
        testDishMediaId,
        testUserId,
        'like',
        false, // not anonymous
      );

      expect(mockTx.dish_media_likes.upsert).toHaveBeenCalledWith({
        where: {
          dish_media_id_user_id: {
            dish_media_id: testDishMediaId,
            user_id: testUserId,
          },
        },
        update: {},
        create: {
          dish_media_id: testDishMediaId,
          user_id: testUserId,
        },
      });

      expect(mockTx.dish_media_analysis_results.update).toHaveBeenCalledWith({
        where: { dish_media_id: testDishMediaId },
        data: {
          like_total: { increment: BigInt(1) },
          updated_at: expect.any(Date),
        },
      });
    });

    it('should add like reaction for anonymous user to reactions', async () => {
      const mockTx = mockPrismaService.prisma;
      mockTx.reactions.upsert.mockResolvedValue({});
      mockTx.dish_media_analysis_results.update.mockResolvedValue({});

      await repository.addReaction(
        mockTx,
        testDishMediaId,
        testUserId,
        'like',
        true, // anonymous
      );

      expect(mockTx.reactions.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id_target_type_target_id_action_type: expect.objectContaining({
              user_id: testUserId,
              target_type: 'dish_media',
              target_id: testDishMediaId,
              action_type: 'like',
            }),
          }),
          create: expect.objectContaining({
            user_id: testUserId,
            target_type: 'dish_media',
            target_id: testDishMediaId,
            action_type: 'like',
          }),
        }),
      );

      expect(mockTx.dish_media_analysis_results.update).toHaveBeenCalled();
    });

    it('should add save reaction to reactions table', async () => {
      const mockTx = mockPrismaService.prisma;
      mockTx.reactions.upsert.mockResolvedValue({});
      mockTx.dish_media_analysis_results.update.mockResolvedValue({});

      await repository.addReaction(
        mockTx,
        testDishMediaId,
        testUserId,
        'save',
        false,
      );

      expect(mockTx.reactions.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            action_type: 'save',
          }),
        }),
      );

      expect(mockTx.dish_media_analysis_results.update).toHaveBeenCalledWith({
        where: { dish_media_id: testDishMediaId },
        data: {
          save_total: { increment: BigInt(1) },
          updated_at: expect.any(Date),
        },
      });
    });

    it('should add open_map reaction to reactions table', async () => {
      const mockTx = mockPrismaService.prisma;
      mockTx.reactions.upsert.mockResolvedValue({});
      mockTx.dish_media_analysis_results.update.mockResolvedValue({});

      await repository.addReaction(
        mockTx,
        testDishMediaId,
        testUserId,
        'open_map',
        false,
      );

      expect(mockTx.reactions.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            action_type: 'open_map',
          }),
        }),
      );

      expect(mockTx.dish_media_analysis_results.update).toHaveBeenCalledWith({
        where: { dish_media_id: testDishMediaId },
        data: {
          open_map_total: { increment: BigInt(1) },
          updated_at: expect.any(Date),
        },
      });
    });
  });

  describe('removeReaction', () => {
    it('should remove like reaction for authenticated user and decrement', async () => {
      const mockTx = mockPrismaService.prisma;
      mockTx.dish_media_likes.deleteMany.mockResolvedValue({ count: 1 });
      mockTx.dish_media_analysis_results.update.mockResolvedValue({});

      await repository.removeReaction(
        mockTx,
        testDishMediaId,
        testUserId,
        'like',
        false,
      );

      expect(mockTx.dish_media_likes.deleteMany).toHaveBeenCalledWith({
        where: {
          dish_media_id: testDishMediaId,
          user_id: testUserId,
        },
      });

      expect(mockTx.dish_media_analysis_results.update).toHaveBeenCalledWith({
        where: { dish_media_id: testDishMediaId },
        data: {
          like_total: { decrement: BigInt(1) },
          updated_at: expect.any(Date),
        },
      });
    });

    it('should not decrement if no rows were deleted', async () => {
      const mockTx = mockPrismaService.prisma;
      mockTx.dish_media_likes.deleteMany.mockResolvedValue({ count: 0 });

      await repository.removeReaction(
        mockTx,
        testDishMediaId,
        testUserId,
        'like',
        false,
      );

      expect(mockTx.dish_media_analysis_results.update).not.toHaveBeenCalled();
    });

    it('should remove save reaction and decrement save_total', async () => {
      const mockTx = mockPrismaService.prisma;
      mockTx.reactions.deleteMany.mockResolvedValue({ count: 1 });
      mockTx.dish_media_analysis_results.update.mockResolvedValue({});

      await repository.removeReaction(
        mockTx,
        testDishMediaId,
        testUserId,
        'save',
        false,
      );

      expect(mockTx.reactions.deleteMany).toHaveBeenCalled();
      expect(mockTx.dish_media_analysis_results.update).toHaveBeenCalledWith({
        where: { dish_media_id: testDishMediaId },
        data: {
          save_total: { decrement: BigInt(1) },
          updated_at: expect.any(Date),
        },
      });
    });
  });

  describe('addImpression', () => {
    it('should add impression and increment impr_total', async () => {
      const mockTx = mockPrismaService.prisma;
      mockTx.dish_media_impressions.findFirst.mockResolvedValue(null);
      mockTx.dish_media_impressions.create.mockResolvedValue({});
      mockTx.dish_media_analysis_results.update.mockResolvedValue({});

      await repository.addImpression(
        mockTx,
        testDishMediaId,
        testUserId,
        testSessionId,
        'feed',
      );

      expect(mockTx.dish_media_impressions.findFirst).toHaveBeenCalledWith({
        where: {
          dish_media_id: testDishMediaId,
          session_id: testSessionId,
        },
      });

      expect(mockTx.dish_media_impressions.create).toHaveBeenCalledWith({
        data: {
          dish_media_id: testDishMediaId,
          user_id: testUserId,
          session_id: testSessionId,
          source: 'feed',
        },
      });

      expect(mockTx.dish_media_analysis_results.update).toHaveBeenCalledWith({
        where: { dish_media_id: testDishMediaId },
        data: {
          impr_total: { increment: BigInt(1) },
          updated_at: expect.any(Date),
        },
      });
    });

    it('should not add duplicate impression for same session_id', async () => {
      const mockTx = mockPrismaService.prisma;
      mockTx.dish_media_impressions.findFirst.mockResolvedValue({
        id: 'existing-id',
      });

      await repository.addImpression(
        mockTx,
        testDishMediaId,
        testUserId,
        testSessionId,
        'feed',
      );

      expect(mockTx.dish_media_impressions.create).not.toHaveBeenCalled();
      expect(mockTx.dish_media_analysis_results.update).not.toHaveBeenCalled();
    });
  });

  describe('removeImpression', () => {
    it('should remove impression and decrement impr_total', async () => {
      const mockTx = mockPrismaService.prisma;
      mockTx.dish_media_impressions.deleteMany.mockResolvedValue({ count: 1 });
      mockTx.dish_media_analysis_results.update.mockResolvedValue({});

      await repository.removeImpression(mockTx, testDishMediaId, testSessionId);

      expect(mockTx.dish_media_impressions.deleteMany).toHaveBeenCalledWith({
        where: {
          dish_media_id: testDishMediaId,
          session_id: testSessionId,
        },
      });

      expect(mockTx.dish_media_analysis_results.update).toHaveBeenCalledWith({
        where: { dish_media_id: testDishMediaId },
        data: {
          impr_total: { decrement: BigInt(1) },
          updated_at: expect.any(Date),
        },
      });
    });

    it('should not decrement if no impression was deleted', async () => {
      const mockTx = mockPrismaService.prisma;
      mockTx.dish_media_impressions.deleteMany.mockResolvedValue({ count: 0 });

      await repository.removeImpression(mockTx, testDishMediaId, testSessionId);

      expect(mockTx.dish_media_analysis_results.update).not.toHaveBeenCalled();
    });
  });
});

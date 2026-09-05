// api/src/v1/dish-media/dish-media.assembler.spec.ts
//
// Unit tests for DishMediaAssembler Signed Cookie generation
//

import { Test, TestingModule } from '@nestjs/testing';
import { DishMediaAssembler } from './dish-media.assembler';
import { StorageService } from '../../core/storage/storage.service';
import { RestaurantsAssembler } from '../restaurants/restaurants.assembler';
import { CookieQueueService } from '../../core/cookie-queue/cookie-queue.service';
import { AppLoggerService } from '../../core/logger/logger.service';

// Mock environment config before importing anything that depends on it
jest.mock('src/core/config/env', () => ({
  env: {
    API_COMMIT_ID: 'test',
    API_NODE_ENV: 'test',
    CORS_ORIGIN: 'http://localhost:3000',
    DB_SCHEMA: 'test',
    SUPABASE_JWT_SECRET: 'test-secret',
    GOOGLE_PLACE_API_KEY: 'test-key',
    GCS_BUCKET_NAME: 'test-bucket',
    GCS_BUCKET_PUBLIC_NAME: 'test-bucket-public',
    GCS_STATIC_MASTER_DIR_PATH: 'static',
    CLAUDE_API_KEY: 'test-claude-key',
    GOOGLE_API_KEY: 'test-google-key',
    GOOGLE_SEARCH_ENGINE_ID: 'test-search-engine',
    GCP_PROJECT: 'test-project',
    TASKS_LOCATION: 'us-central1',
    TRANSCODER_LOCATION: 'us-central1',
    CLOUD_RUN_URL: 'http://localhost:3000',
    TASKS_INVOKER_SA: 'test@test.iam.gserviceaccount.com',
    CDN_HOST: 'test-cdn.example.com',
    CDN_KEY_NAME: 'test-key',
    CDN_KEY_SECRET_B64: Buffer.from('test-secret-key-16').toString('base64'),
    CDN_SIGNED_COOKIE_TTL_SECONDS: 600,
  },
}));

describe('DishMediaAssembler - Signed Cookie Generation', () => {
  let assembler: DishMediaAssembler;
  let mockStorage: jest.Mocked<StorageService>;
  let mockRestaurantsAssembler: jest.Mocked<RestaurantsAssembler>;
  let mockCookieQueue: jest.Mocked<CookieQueueService>;

  beforeEach(async () => {
    const mockStorageService = {
      generateCdnSignedURL: jest.fn(),
      generateCdnSignedCookies: jest.fn(),
    };

    const mockRestaurantsAssemblerService = {
      enrichRestaurantsWithImageUrls: jest.fn(),
    };

    const mockCookieQueueService = {
      enqueue: jest.fn(),
      getAll: jest.fn(),
      clear: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishMediaAssembler,
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: RestaurantsAssembler,
          useValue: mockRestaurantsAssemblerService,
        },
        {
          provide: CookieQueueService,
          useValue: mockCookieQueueService,
        },
        {
          // DishMediaAssembler は logger を DI するので、テストモジュールにも要る
          provide: AppLoggerService,
          useValue: {
            debug: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    assembler = module.get<DishMediaAssembler>(DishMediaAssembler);
    mockStorage = module.get(StorageService);
    mockRestaurantsAssembler = module.get(RestaurantsAssembler);
    mockCookieQueue = module.get(CookieQueueService);
  });

  describe('toDishMediaEntry', () => {
    it('should enqueue CDN signed cookies for video media', () => {
      // Arrange
      const dishMediaEntries = [
        {
          restaurant: {} as any,
          dish: { reviewCount: 5, averageRating: 4.5 } as any,
          dish_media: {
            id: 'media-1',
            media_type: 'video' as const,
            // getMediaUrl() は media_processing_status が 'completed' のときだけ
            // 動画の CDN URL を作る。fixture に無く、このテストは通っていなかった
            media_processing_status: 'completed',
            media_path: 'user-uploads/user-1/video.mp4',
            thumbnail_path: 'user-uploads/user-1/thumb.jpg',
            isSaved: false,
            isLiked: false,
            likeCount: 10,
          } as any,
          dish_reviews: [],
        },
      ];

      mockRestaurantsAssembler.enrichRestaurantsWithImageUrls.mockReturnValue(
        {} as any,
      );
      mockStorage.generateCdnSignedCookies.mockReturnValue([
        'Cloud-CDN-Cookie=test-cookie; Domain=.example.com; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=None; Partitioned',
      ]);
      mockStorage.generateCdnSignedURL.mockReturnValue(
        'https://test-cdn.example.com/test/resized/thumb.jpg?Expires=123&KeyName=test-key&Signature=abc',
      );

      // Act
      const result = assembler.toDishMediaEntry(dishMediaEntries as any);

      // Assert
      expect(mockStorage.generateCdnSignedCookies).toHaveBeenCalled();
      expect(mockCookieQueue.enqueue).toHaveBeenCalled();
      expect(result.items[0].dish_media.mediaUrl).not.toContain('Expires=');
      expect(result.items[0].dish_media.mediaUrl).not.toContain('KeyName=');
      expect(result.items[0].dish_media.mediaUrl).not.toContain('Signature=');
    });

    it('should NOT enqueue CDN signed cookies for image media', () => {
      // Arrange
      const dishMediaEntries = [
        {
          restaurant: {} as any,
          dish: { reviewCount: 5, averageRating: 4.5 } as any,
          dish_media: {
            id: 'media-1',
            media_type: 'image' as const,
            media_path: 'user-uploads/user-1/image.jpg',
            thumbnail_path: 'user-uploads/user-1/thumb.jpg',
            isSaved: false,
            isLiked: false,
            likeCount: 10,
          } as any,
          dish_reviews: [],
        },
      ];

      mockRestaurantsAssembler.enrichRestaurantsWithImageUrls.mockReturnValue(
        {} as any,
      );
      mockStorage.generateCdnSignedURL.mockReturnValue(
        'https://test-cdn.example.com/test/resized/image.jpg?Expires=123&KeyName=test-key&Signature=abc',
      );

      // Act
      const result = assembler.toDishMediaEntry(dishMediaEntries as any);

      // Assert
      expect(mockStorage.generateCdnSignedCookies).not.toHaveBeenCalled();
      expect(mockCookieQueue.enqueue).not.toHaveBeenCalled();
      expect(result.items[0].dish_media.mediaUrl).toContain('Expires=');
      expect(result.items[0].dish_media.mediaUrl).toContain('KeyName=');
      expect(result.items[0].dish_media.mediaUrl).toContain('Signature=');
    });

    it('should deduplicate CDN signed cookies for multiple videos with same prefix', () => {
      // Arrange
      const dishMediaEntries = [
        {
          restaurant: {} as any,
          dish: { reviewCount: 5, averageRating: 4.5 } as any,
          dish_media: {
            id: 'media-1',
            media_type: 'video' as const,
            media_processing_status: 'completed',
            media_path: 'user-uploads/user-1/video1.mp4',
            thumbnail_path: 'user-uploads/user-1/thumb1.jpg',
            isSaved: false,
            isLiked: false,
            likeCount: 10,
          } as any,
          dish_reviews: [],
        },
        {
          restaurant: {} as any,
          dish: { reviewCount: 5, averageRating: 4.5 } as any,
          dish_media: {
            id: 'media-2',
            media_type: 'video' as const,
            media_processing_status: 'completed',
            media_path: 'user-uploads/user-1/video2.mp4',
            thumbnail_path: 'user-uploads/user-1/thumb2.jpg',
            isSaved: false,
            isLiked: false,
            likeCount: 5,
          } as any,
          dish_reviews: [],
        },
      ];

      mockRestaurantsAssembler.enrichRestaurantsWithImageUrls.mockReturnValue(
        {} as any,
      );
      mockStorage.generateCdnSignedCookies.mockReturnValue([
        'Cloud-CDN-Cookie=test-cookie; Domain=.example.com; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=None; Partitioned',
      ]);
      mockStorage.generateCdnSignedURL.mockReturnValue(
        'https://test-cdn.example.com/test/resized/thumb.jpg?Expires=123&KeyName=test-key&Signature=abc',
      );

      // Act
      const result = assembler.toDishMediaEntry(dishMediaEntries as any);

      // Assert
      expect(result.items.length).toBe(2);
      // generateCdnSignedCookies should be called for each unique prefix
      expect(mockStorage.generateCdnSignedCookies).toHaveBeenCalled();
      expect(mockCookieQueue.enqueue).toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /*        #1395 external_embed とサムネイル URL の分岐                */
  /* ------------------------------------------------------------------ */
  describe('#1395 render_type とサムネイル URL', () => {
    const baseEntry = (
      dishMedia: Record<string, unknown>,
      dish: Record<string, unknown> = {},
    ) => [
      {
        restaurant: {} as any,
        dish: { reviewCount: 0, averageRating: 0, ...dish } as any,
        dish_media: {
          id: 'media-1',
          media_type: 'video' as const,
          thumbnail_path: 'user-uploads/user-1/thumb.jpg',
          thumbnail_processing_status: 'completed',
          isSaved: false,
          isLiked: false,
          likeCount: 0,
          ...dishMedia,
        } as any,
        dish_reviews: [],
      },
    ];

    beforeEach(() => {
      mockRestaurantsAssembler.enrichRestaurantsWithImageUrls.mockReturnValue(
        {} as any,
      );
      mockStorage.generateCdnSignedURL.mockImplementation(
        (url: string) => `${url}?Signature=abc`,
      );
    });

    it('external_embed は自ストレージに実体が無いので mediaUrl を作らない', () => {
      const result = assembler.toDishMediaEntry(
        baseEntry({
          render_type: 'external_embed',
          media_path: null,
          media_processing_status: 'idle',
        }) as any,
      );

      expect(result.items[0].dish_media.mediaUrl).toBeNull();
      // 動画の Signed Cookie も発行されない（mediaUrl が null なので対象外になる）
      expect(mockStorage.generateCdnSignedCookies).not.toHaveBeenCalled();
    });

    it('#1513 削除済み（deleted_at あり）は mediaUrl / thumbnailImageUrl を作らない', () => {
      // 墓標を出す画面（いいね一覧 / 保存一覧 / 通知 / レビューのサムネイル）は
      // includeDeleted で削除済みの行も受け取る。行は残すが中身は出さないのが
      // 「削除された」の意味なので、署名 URL の発行はここで止める。
      // GCS の実体は当面残す方針（#1513 設計 問2）なので、URL を作れば見えてしまう
      const result = assembler.toDishMediaEntry(
        baseEntry({
          render_type: 'stored',
          media_path: 'user-uploads/user-1/media.mp4',
          media_processing_status: 'completed',
          deleted_at: new Date('2026-08-24T00:00:00Z'),
        }) as any,
      );

      expect(result.items[0].dish_media.mediaUrl).toBeNull();
      expect(result.items[0].dish_media.thumbnailImageUrl).toBeNull();
      // 動画の Signed Cookie も発行されない
      expect(mockStorage.generateCdnSignedCookies).not.toHaveBeenCalled();
    });

    it('#1513 deleted_at を持たない入力（undefined）は削除済みとして扱わない', () => {
      // ⚠️ これは実際に踏んだ退行の固定。`deleted_at !== null` で書くと undefined が
      // «削除済み» になり、生きている投稿の URL まで消える（7 テストが落ちた）
      const result = assembler.toDishMediaEntry(
        baseEntry({
          render_type: 'stored',
          media_path: 'user-uploads/user-1/media.mp4',
          media_processing_status: 'completed',
        }) as any,
      );

      expect(result.items[0].dish_media.mediaUrl).not.toBeNull();
      expect(result.items[0].dish_media.thumbnailImageUrl).not.toBeNull();
    });

    it('stored なのに media_path が欠けていても落ちず mediaUrl は null', () => {
      const result = assembler.toDishMediaEntry(
        baseEntry({
          render_type: 'stored',
          media_path: null,
          media_processing_status: 'completed',
        }) as any,
      );

      expect(result.items[0].dish_media.mediaUrl).toBeNull();
    });

    it('external_embed でもサムネイルは自ストレージ（thumbnail_path）から組む', () => {
      // #1395 仕様追補: サムネイルは全 provider を自ストレージへ保存する統一キャッシュ方式。
      // 外部 CDN の URL をそのまま返す経路は存在しない（thumbnail_external_url は撤回済み）。
      const result = assembler.toDishMediaEntry(
        baseEntry({
          render_type: 'external_embed',
          media_path: null,
          media_processing_status: 'idle',
          thumbnail_processing_status: 'processing',
        }) as any,
      );

      const url = result.items[0].dish_media.thumbnailImageUrl;
      // 自 CDN の署名付き URL であること（provider の CDN へ素通しにしない）
      expect(url).toContain('test-cdn.example.com');
      expect(url).toContain('user-uploads/user-1/thumb.jpg');
      expect(url).toContain('Signature=');
      // 自ストレージにサムネイルがある行では従来どおり string が返る
      expect(typeof url).toBe('string');
    });

    it('#1399 thumbnail_path が空でも落ちず、外部サムネイル URL へ落ちる', () => {
      // SNS 取り込み（dish-media-imports）は自ストレージにサムネイルを持たないので
      // thumbnail_path: '' で作られる。ここで buildResizedPath へ '' を渡すと
      // 'Invalid originalPath' を throw し、**その行を含む一覧全体が 500 になる**
      // （実際に my-dishes が全滅した）。guard の存在を固定する。
      const result = assembler.toDishMediaEntry(
        baseEntry({
          render_type: 'external_embed',
          media_path: null,
          media_processing_status: 'completed',
          thumbnail_path: '',
          thumbnail_processing_status: 'completed',
          externalEmbed: {
            id: 'embed-1',
            dish_media_id: 'media-1',
            provider: 'tiktok',
            external_content_id: 'c-1',
            canonical_url: 'https://www.tiktok.com/@a/video/1',
            embed_status: 'available',
            last_verified_at: null,
            thumbnail_url: 'https://p16-sign.tiktokcdn.com/thumb.webp',
          },
        }) as any,
      );

      expect(result.items[0].dish_media.thumbnailImageUrl).toBe(
        'https://p16-sign.tiktokcdn.com/thumb.webp',
      );
    });

    it('#1399 外部サムネイルも無く、埋め込みの行も無ければ null になる', () => {
      const result = assembler.toDishMediaEntry(
        baseEntry({
          render_type: 'external_embed',
          media_path: null,
          media_processing_status: 'completed',
          thumbnail_path: '',
          thumbnail_processing_status: 'completed',
          externalEmbed: null,
        }) as any,
      );

      expect(result.items[0].dish_media.thumbnailImageUrl).toBeNull();
    });

    /*
    #1641 **サムネイルが 1 つも無い取り込み行を «真っ黒» にしない。**

    高速パス（サーバが not_playable と判定済みなら WebView を作らない）を入れた結果、
    それまで Instagram の埋め込みページが描いていた 1 コマ目ごと絵が消え、
    **セルが真っ黒になった**（run 33223480840 の feed-05 で実測）。
    dev の実測では 19 行中 2 行がこの状態だった。
    */
    it('#1641 自前サムネも provider の URL も無い取り込み行は、料理カテゴリの絵へ落ちる', () => {
      const result = assembler.toDishMediaEntry(
        baseEntry(
          {
            render_type: 'external_embed',
            media_path: null,
            media_processing_status: 'completed',
            thumbnail_path: '',
            thumbnail_processing_status: 'completed',
            externalEmbed: {
              id: 'embed-1',
              dish_media_id: 'media-1',
              provider: 'instagram',
              external_content_id: 'Dap33wsTO4p',
              canonical_url: 'https://www.instagram.com/reel/Dap33wsTO4p/',
              embed_status: 'available',
              last_verified_at: null,
              thumbnail_url: null,
            },
          },
          { categoryImageUrl: 'https://cdn/ramen.jpg' },
        ) as any,
      );

      expect(result.items[0].dish_media.thumbnailImageUrl).toBe(
        'https://cdn/ramen.jpg',
      );
    });

    /*
    #1273 **«カテゴリの絵を当てれば構造的に真っ黒が出なくなる» は誤りだった。**

    `dish_categories.image_url` は NOT NULL だが空文字を許す（同期が
    `COALESCE(rep.image_url, '')` で書く）。`??` は空文字を «見つかった» として通すので、
    絵の無いカテゴリでは `thumbnailImageUrl` が空文字のまま画面へ届いていた。
    dev 実測（2026-09-05）: usable 145,392 行のうち 3,119 行（2.15%）が 3 段とも空。

    ⚠️ ここで固定するのは «空文字を «絵がある» と数えない» ことである。
       戻すと全画面フィードの真っ黒なセルが戻る。
    */
    it('#1273 料理カテゴリの絵が空文字なら、空文字ではなく null を返す', () => {
      const result = assembler.toDishMediaEntry(
        baseEntry(
          {
            render_type: 'external_embed',
            media_path: null,
            media_processing_status: 'completed',
            thumbnail_path: '',
            thumbnail_processing_status: 'completed',
            externalEmbed: {
              id: 'embed-1',
              dish_media_id: 'media-1',
              provider: 'instagram',
              external_content_id: 'Dap33wsTO4p',
              canonical_url: 'https://www.instagram.com/reel/Dap33wsTO4p/',
              embed_status: 'available',
              last_verified_at: null,
              thumbnail_url: null,
            },
          },
          { categoryImageUrl: '' },
        ) as any,
      );

      expect(result.items[0].dish_media.thumbnailImageUrl).toBeNull();
    });

    it('#1273 provider のサムネイル URL が空文字なら、カテゴリの絵へ落ちる', () => {
      const result = assembler.toDishMediaEntry(
        baseEntry(
          {
            render_type: 'external_embed',
            media_path: null,
            media_processing_status: 'completed',
            thumbnail_path: '',
            thumbnail_processing_status: 'completed',
            externalEmbed: {
              id: 'embed-1',
              dish_media_id: 'media-1',
              provider: 'instagram',
              external_content_id: 'Dap33wsTO4p',
              canonical_url: 'https://www.instagram.com/reel/Dap33wsTO4p/',
              embed_status: 'available',
              last_verified_at: null,
              thumbnail_url: '',
            },
          },
          { categoryImageUrl: 'https://cdn/ramen.jpg' },
        ) as any,
      );

      expect(result.items[0].dish_media.thumbnailImageUrl).toBe(
        'https://cdn/ramen.jpg',
      );
    });

    /*
    ⚠️ **自撮り投稿には当てない。** そちらでサムネイルが無いのは «加工がまだ終わっていない»
       という別の状態で、スケルトンを出すのが正しい。カテゴリの絵を当てると
       «出来上がったのに違う絵が出ている» ように見える。
    */
    it('#1641 stored の行にはカテゴリの絵を当てない', () => {
      const result = assembler.toDishMediaEntry(
        baseEntry(
          {
            render_type: 'stored',
            media_path: null,
            media_processing_status: 'processing',
            thumbnail_path: '',
            thumbnail_processing_status: 'processing',
            externalEmbed: null,
          },
          { categoryImageUrl: 'https://cdn/ramen.jpg' },
        ) as any,
      );

      expect(result.items[0].dish_media.thumbnailImageUrl).toBeNull();
    });

    it('stored でも従来どおり thumbnail_path から組む', () => {
      const result = assembler.toDishMediaEntry(
        baseEntry({
          render_type: 'stored',
          media_path: 'user-uploads/user-1/video.mp4',
          media_processing_status: 'completed',
        }) as any,
      );

      expect(result.items[0].dish_media.thumbnailImageUrl).toContain(
        'test-cdn.example.com',
      );
      expect(result.items[0].dish_media.thumbnailImageUrl).toContain(
        'Signature=',
      );
    });

    it('render_type が未設定（マイグレーション適用前の行）は stored として扱う', () => {
      const result = assembler.toDishMediaEntry(
        baseEntry({
          media_path: 'user-uploads/user-1/video.mp4',
          media_processing_status: 'completed',
        }) as any,
      );

      expect(result.items[0].dish_media.mediaUrl).not.toBeNull();
    });
  });
});

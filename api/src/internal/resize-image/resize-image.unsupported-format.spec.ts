// api/src/internal/resize-image/resize-image.unsupported-format.spec.ts
//
// #1425 【バグ】デコーダが無い形式（HEIC 等）を «恒久失敗» として分類することを固定する
//
// 本番で観測した実物（2026-08-18）:
//   source: bad seek to 565836
//   ...
//   heif: Error while loading plugin: Support for this compression format has not been built in (11.6003)
//
// 先頭の `source: bad seek to` は症状で、原因は末尾の一行。sharp の同梱 libvips は
// HEVC 特許の都合で HEIF デコーダを含まない。原本は GCS 上の不変ファイルなので、
// 何度リトライしても同じ結果になる。恒久失敗と宣言しないと Cloud Tasks が上限まで再試行し、
// 1 枚の画像で media_path と thumbnail_path 合わせて error ログを 16 件積む（実際にそうなった）。
//
// sharp をモックしてデコード失敗だけを再現する（実物の HEIC を固定資産として置かないため）。

import { Test, TestingModule } from '@nestjs/testing';
import {
  PermanentImageError,
  ResizeImageService,
} from './resize-image.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../core/storage/storage.service';
import { AppLoggerService } from '../../core/logger/logger.service';

jest.mock('src/core/config/env', () => ({
  env: {
    API_NODE_ENV: 'test',
    GCS_BUCKET_NAME: 'test-bucket',
    GCS_BUCKET_PUBLIC_NAME: 'test-bucket-public',
  },
}));

/** 本番ログからそのまま持ってきたメッセージ */
const HEIF_ERROR_MESSAGE = [
  'source: bad seek to 565836',
  'source: bad seek to 565819',
  'heif: Error while loading plugin: Support for this compression format has not been built in (11.6003)',
].join('\n');

const sharpFailure = { message: HEIF_ERROR_MESSAGE };

jest.mock('sharp', () => {
  const factory = () => ({
    rotate: () => ({
      resize: () => ({
        webp: () => ({
          toBuffer: () => Promise.reject(new Error(sharpFailure.message)),
        }),
      }),
    }),
  });
  return factory;
});

const mockJimpRead = jest.fn();
jest.mock('jimp', () => ({
  Jimp: { read: (...args: unknown[]) => mockJimpRead(...args) },
  JimpMime: { jpeg: 'image/jpeg' },
}));

describe('#1425 ResizeImageService - デコーダが無い形式は恒久失敗', () => {
  let service: ResizeImageService;
  let logger: {
    error: jest.Mock;
    warn: jest.Mock;
    log: jest.Mock;
    debug: jest.Mock;
  };
  let prisma: { prisma: { dish_media: { updateMany: jest.Mock } } };

  const dto = {
    table: 'dish_media',
    column: 'media_path',
    recordId: 'e2731728-3ee1-404b-8e0d-966cd5259fdc',
    size: 1024 as 64 | 256 | 512 | 1024,
    originalPath:
      'production/user-uploads/96638862-e2fb-4435-a399-188aad834127/image-heic/1787043814725_media.bin',
  };

  beforeEach(async () => {
    sharpFailure.message = HEIF_ERROR_MESSAGE;
    mockJimpRead.mockReset();

    logger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
    };
    prisma = {
      prisma: {
        dish_media: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResizeImageService,
        { provide: AppLoggerService, useValue: logger },
        {
          provide: StorageService,
          useValue: {
            fileExists: jest.fn().mockResolvedValue(false),
            generateSignedUrl: jest
              .fn()
              .mockResolvedValue('https://example.com/signed'),
            uploadFileAtPath: jest.fn(),
          },
        },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ResizeImageService);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
    }) as unknown as typeof fetch;
  });

  it('PermanentImageError（UNSUPPORTED_IMAGE_FORMAT）として投げる', async () => {
    // これが通常の Error のままだと Controller が 5xx を返し、
    // Cloud Tasks が上限まで無駄にリトライする
    await expect(service.resizeAndStoreImage(dto)).rejects.toBeInstanceOf(
      PermanentImageError,
    );

    await expect(service.resizeAndStoreImage(dto)).rejects.toMatchObject({
      code: 'UNSUPPORTED_IMAGE_FORMAT',
    });
  });

  it('Jimp の再エンコードを試さない（HEIC は Jimp でも読めないため無駄）', async () => {
    await expect(service.resizeAndStoreImage(dto)).rejects.toThrow();

    expect(mockJimpRead).not.toHaveBeenCalled();
  });

  it('dish_media の processing_status を failed にする', async () => {
    await expect(service.resizeAndStoreImage(dto)).rejects.toThrow();

    // #1599 「今の値と違うときだけ書く」形になったので where に NOT が付く。
    // 再配送で同じ status を書き直して lock_no / updated_at を動かさないため
    expect(prisma.prisma.dish_media.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: dto.recordId,
          NOT: { media_processing_status: 'failed' },
        },
        data: expect.objectContaining({ media_processing_status: 'failed' }),
      }),
    );
  });

  it('原因を追えるよう originalPath を含むログを残す', async () => {
    await expect(service.resizeAndStoreImage(dto)).rejects.toThrow();

    // 外側の恒久失敗ログには params（＝ originalPath）が載っていること。
    // これが無いと «どの画像か» をログから特定できず、調査を毎回ゼロからやり直すことになる
    const permanentLog = logger.error.mock.calls.find(
      ([event]) => event === 'ResizeAndStoreImagePermanentFailure',
    );
    expect(permanentLog).toBeDefined();
    expect(permanentLog?.[2]).toMatchObject({
      params: expect.objectContaining({ originalPath: dto.originalPath }),
      code: 'UNSUPPORTED_IMAGE_FORMAT',
    });
  });

  it('⚠️ 判定は狭く保つ: 別の heif エラーは恒久失敗にしない', async () => {
    // `heif:` だけでマッチさせると、将来 HEIF 対応を積んだ後に出る
    // 一時的な heif エラー（I/O・メモリ起因など）まで恒久扱いにしてしまう。
    // リトライで救えるものを止めるのは #514 が繰り返し警告している失敗パターン。
    sharpFailure.message = 'heif: Error while decoding: temporary I/O failure';

    await expect(service.resizeAndStoreImage(dto)).rejects.not.toBeInstanceOf(
      PermanentImageError,
    );
  });
});

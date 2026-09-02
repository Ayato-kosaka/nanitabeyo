// api/src/internal/media-status-idempotent-write.spec.ts
//
// #1599 **再配送で dish_media の行が «何も変わっていないのに» 書き換わる件。**
//
// Cloud Tasks も Pub/Sub Push も at-least-once 配送で、ハンドラが成功しても
// 応答が届かなければ同じジョブ／通知がもう一度届く。
// リサイズ完了もトランスコード完了も «同じ status を書く» 処理なので、
// 再配送そのものは正しく無害に終わる。にもかかわらず以前は無条件 UPDATE で
//
//   - `lock_no` が 1 つ進む
//   - `updated_at` が現在時刻へ動く（«最後に中身が変わった時刻» が読めなくなる）
//   - 行の新しいバージョンが書かれる（WAL / VACUUM 対象が増える）
//
// が起きていた。
//
// **2 つのサービスに同じ形の欠陥があったので、両方をここで固定する。**
// 片方だけ直すと、もう片方で同じことが残る。

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { AppLoggerService } from '../core/logger/logger.service';
import { TranscoderService } from '../core/transcoder/transcoder.service';

jest.mock('src/core/config/env', () => ({
  env: {
    API_COMMIT_ID: 'test',
    API_NODE_ENV: 'test',
    DB_SCHEMA: 'test',
    GCS_BUCKET_NAME: 'test-bucket',
    GCP_PROJECT: 'test-project',
    TRANSCODER_LOCATION: 'us-central1',
    TRANSCODER_PUBSUB_TOPIC: 'projects/test-project/topics/transcoder',
  },
}));

// TranscoderServiceClient はコンストラクタで実際の GCP クライアントを作るのでモックする
const mockGetJob = jest.fn();
jest.mock('@google-cloud/video-transcoder', () => ({
  TranscoderServiceClient: jest.fn().mockImplementation(() => ({
    getJob: mockGetJob,
  })),
  protos: {},
}));

// `jest.mock` は import より前へ巻き上げられるので、素の import で問題ない
import { ResizeImageService } from './resize-image/resize-image.service';
import { TranscoderWebhookService } from './transcoder/transcoder-webhook.service';

const RECORD_ID = '12345678-1234-1234-1234-123456789012';

/** `dish_media.updateMany` だけを持つ最小の PrismaService モック */
function makePrismaMock(updateManyCount: number) {
  const updateMany = jest.fn().mockResolvedValue({ count: updateManyCount });
  const update = jest.fn().mockResolvedValue({});
  return {
    mock: {
      prisma: { dish_media: { updateMany, update } },
      withTransaction: jest.fn(),
    },
    updateMany,
    update,
  };
}

const loggerMock = () => ({
  debug: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

describe('#1599 リサイズ完了の status 書き込み（ResizeImageService）', () => {
  /**
   * `resizeAndStoreImage` の «リサイズ済みが既にある» 経路が、再配送で通る道である。
   * ここを通って `completed` を書きに行く。
   */
  async function buildService(updateManyCount: number) {
    const prisma = makePrismaMock(updateManyCount);
    const storage = {
      fileExists: jest.fn().mockResolvedValue(true), // 既にリサイズ済み = 再配送された状態
      generateSignedUrl: jest.fn().mockResolvedValue('https://example.com/x'),
      uploadFileAtPath: jest.fn(),
    };
    const logger = loggerMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResizeImageService,
        { provide: PrismaService, useValue: prisma.mock },
        { provide: StorageService, useValue: storage },
        { provide: AppLoggerService, useValue: logger },
      ],
    }).compile();

    return {
      service: module.get<ResizeImageService>(ResizeImageService),
      prisma,
      logger,
    };
  }

  const dto = {
    table: 'dish_media',
    column: 'media_path',
    recordId: RECORD_ID,
    size: 512 as 64 | 256 | 512 | 1024,
    originalPath: 'test/path/image.jpg',
  };

  it('既に同じ status なら 1 行も書かない（lock_no を進めない）', async () => {
    // count: 0 = WHERE に一致しなかった = 既にその status だった
    const { service, prisma, logger } = await buildService(0);

    const result = await service.resizeAndStoreImage(dto as never);

    expect(result.alreadyExisted).toBe(true);

    // 無条件 UPDATE（update）を使っていないこと。使っていると必ず 1 行書く
    expect(prisma.update).not.toHaveBeenCalled();

    // 「今の値と違うときだけ書く」が SQL 側の条件になっていること。
    // 読んでから比べて書く形にすると、その隙間に別のタスクが書き込める
    expect(prisma.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: RECORD_ID,
          NOT: { media_processing_status: 'completed' },
        },
      }),
    );

    expect(logger.log).toHaveBeenCalledWith(
      'DishMediaProcessingStatusUnchanged',
      'updateDishMediaProcessingStatus',
      expect.objectContaining({ recordId: RECORD_ID, status: 'completed' }),
    );
  });

  it('status が変わるときは従来どおり lock_no を進めて書く', async () => {
    const { service, prisma, logger } = await buildService(1);

    await service.resizeAndStoreImage(dto as never);

    expect(prisma.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          media_processing_status: 'completed',
          lock_no: { increment: 1 },
        }),
      }),
    );
    expect(logger.log).toHaveBeenCalledWith(
      'DishMediaProcessingStatusUpdated',
      'updateDishMediaProcessingStatus',
      expect.objectContaining({ recordId: RECORD_ID }),
    );
  });

  it('column が media_path 以外ならサムネイル側の列を見る', async () => {
    const { service, prisma } = await buildService(0);

    await service.resizeAndStoreImage({
      ...dto,
      column: 'thumbnail_path',
    } as never);

    expect(prisma.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: RECORD_ID,
          NOT: { thumbnail_processing_status: 'completed' },
        },
      }),
    );
  });
});

describe('#1599 トランスコード完了の status 書き込み（TranscoderWebhookService）', () => {
  async function buildService(updateManyCount: number) {
    const prisma = makePrismaMock(updateManyCount);
    const logger = loggerMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscoderWebhookService,
        { provide: PrismaService, useValue: prisma.mock },
        { provide: AppLoggerService, useValue: logger },
        {
          provide: TranscoderService,
          useValue: { createTranscodeJob: jest.fn() },
        },
        // #1599 ③ で TranscoderWebhookService が claim 用に StorageService を取るようになった。
        // この suite は SUCCEEDED しか流さないので使われないが、DI は解決できる必要がある
        {
          provide: StorageService,
          useValue: {
            claimOnce: jest.fn(),
            deleteFileIfExists: jest.fn(),
          },
        },
      ],
    }).compile();

    return {
      service: module.get<TranscoderWebhookService>(TranscoderWebhookService),
      prisma,
      logger,
    };
  }

  const JOB_NAME = 'projects/p/locations/l/jobs/j';

  beforeEach(() => {
    mockGetJob.mockReset();
    mockGetJob.mockResolvedValue([
      {
        name: JOB_NAME,
        labels: {
          table_name: 'dish_media',
          column_name: 'media_path',
          record_id: RECORD_ID,
        },
      },
    ]);
  });

  it('既に completed なら 1 行も書かない（lock_no を進めない）', async () => {
    const { service, prisma, logger } = await buildService(0);

    await service.handleJobNotification(JOB_NAME, 'SUCCEEDED');

    expect(prisma.update).not.toHaveBeenCalled();
    expect(prisma.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: RECORD_ID,
          NOT: { media_processing_status: 'completed' },
        },
      }),
    );
    expect(logger.log).toHaveBeenCalledWith(
      'DishMediaProcessingStatusUnchanged',
      'updateDishMediaProcessingStatus',
      expect.objectContaining({ recordId: RECORD_ID, status: 'completed' }),
    );
  });

  it('status が変わるときは従来どおり lock_no を進めて書く', async () => {
    const { service, prisma } = await buildService(1);

    await service.handleJobNotification(JOB_NAME, 'SUCCEEDED');

    expect(prisma.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          media_processing_status: 'completed',
          lock_no: { increment: 1 },
        }),
      }),
    );
  });
});

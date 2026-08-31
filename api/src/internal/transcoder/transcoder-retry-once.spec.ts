// api/src/internal/transcoder/transcoder-retry-once.spec.ts
//
// #1599 **AudioMissing のリトライが、再配送のたびに新しいジョブを作っていた件。**
//
// Pub/Sub Push は at-least-once 配送で、ハンドラが成功しても応答が届かなければ
// 同じ FAILED 通知がもう一度届く。分岐の判定材料 `labels.retry` は
// **失敗した «元のジョブ» の label** で、こちらがリトライを作っても変わらない。
// よって再配送は毎回リトライ分岐へ入り、
//
//   - 課金されるトランスコードジョブが何本も走る
//   - 同じ outputUri へ複数のジョブが同時に書く（出力が壊れうる）
//
// が起きていた。
//
// Transcoder の `CreateJobRequest` には **job 名を指定する欄が無い**
// （`ICreateJobRequest` は parent と job だけ）ので «同じ id で作れば 1 本» にできない。
// 作る前に GCS 上のマーカーを排他生成して権利を取る（claim-then-create）。

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../core/storage/storage.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { TranscoderService } from '../../core/transcoder/transcoder.service';

jest.mock('src/core/config/env', () => ({
  env: {
    API_NODE_ENV: 'test',
    DB_SCHEMA: 'test',
    GCS_BUCKET_NAME: 'test-bucket',
    GCP_PROJECT: 'test-project',
    TRANSCODER_LOCATION: 'us-central1',
    TRANSCODER_PUBSUB_TOPIC: 'projects/test-project/topics/transcoder',
  },
}));

jest.mock('../../core/config/env', () => ({
  env: {
    API_NODE_ENV: 'test',
    DB_SCHEMA: 'test',
    GCS_BUCKET_NAME: 'test-bucket',
    GCP_PROJECT: 'test-project',
    TRANSCODER_LOCATION: 'us-central1',
    TRANSCODER_PUBSUB_TOPIC: 'projects/test-project/topics/transcoder',
  },
}));

const mockGetJob = jest.fn();
jest.mock('@google-cloud/video-transcoder', () => ({
  TranscoderServiceClient: jest.fn().mockImplementation(() => ({
    getJob: mockGetJob,
  })),
  protos: {},
}));

import { TranscoderWebhookService } from './transcoder-webhook.service';

const RECORD_ID = '12345678-1234-1234-1234-123456789012';
const JOB_NAME = 'projects/p/locations/l/jobs/failed-job';
const OUTPUT_URI = `gs://test-bucket/test/transcoded-video/dish_media/media_path/${RECORD_ID}/video/`;
const EXPECTED_CLAIM = `test/transcoded-video/dish_media/media_path/${RECORD_ID}/video/.retry-1.claim`;

/** 音声トラックが無くて落ちた «元のジョブ» の getJob 応答 */
function audioMissingJob() {
  return [
    {
      name: JOB_NAME,
      labels: {
        table_name: 'dish_media',
        column_name: 'media_path',
        record_id: RECORD_ID,
      },
      error: { message: 'must be encoded with an audio track' },
      config: {
        inputs: [{ uri: 'gs://test-bucket/test/user-uploads/x/video.mp4' }],
        output: { uri: OUTPUT_URI },
      },
    },
  ];
}

describe('#1599 AudioMissing のリトライは 1 回だけ', () => {
  let service: TranscoderWebhookService;
  let claimOnce: jest.Mock;
  let deleteFileIfExists: jest.Mock;
  let createTranscodeJob: jest.Mock;
  let update: jest.Mock;
  let updateMany: jest.Mock;
  /**
   * status の書き込み方（update / updateMany）は #1599 の別 PR で入れ替わる。
   * ここで見たいのは «書いたか / 書かなかったか» なので、両方を数える
   */
  const statusWrites = () =>
    update.mock.calls.length + updateMany.mock.calls.length;
  let logger: {
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
  };

  beforeEach(async () => {
    mockGetJob.mockReset();
    mockGetJob.mockResolvedValue(audioMissingJob());

    claimOnce = jest.fn().mockResolvedValue(true);
    deleteFileIfExists = jest.fn().mockResolvedValue(true);
    createTranscodeJob = jest.fn().mockResolvedValue('jobs/retry');
    update = jest.fn().mockResolvedValue({});
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscoderWebhookService,
        { provide: AppLoggerService, useValue: logger },
        { provide: TranscoderService, useValue: { createTranscodeJob } },
        {
          provide: PrismaService,
          useValue: {
            prisma: { dish_media: { update, updateMany } },
          },
        },
        {
          provide: StorageService,
          useValue: { claimOnce, deleteFileIfExists },
        },
      ],
    }).compile();

    service = module.get<TranscoderWebhookService>(TranscoderWebhookService);
  });

  it('1 回目は権利を取ってからリトライジョブを作る', async () => {
    await service.handleJobNotification(JOB_NAME, 'FAILED');

    expect(claimOnce).toHaveBeenCalledWith(
      EXPECTED_CLAIM,
      expect.objectContaining({ record_id: RECORD_ID }),
    );
    expect(createTranscodeJob).toHaveBeenCalledWith(
      expect.objectContaining({
        outputUri: OUTPUT_URI,
        labels: expect.objectContaining({ retry: '1', video_only: 'true' }),
      }),
    );
  });

  it('権利を «取ってから» 作る（作ってから記録する形になっていないこと）', async () => {
    const order: string[] = [];
    claimOnce.mockImplementation(() => {
      order.push('claim');
      return Promise.resolve(true);
    });
    createTranscodeJob.mockImplementation(() => {
      order.push('create');
      return Promise.resolve('jobs/retry');
    });

    await service.handleJobNotification(JOB_NAME, 'FAILED');

    // 逆順だと «作ったが記録の前に応答が落ちた» ケースで二重に作る
    expect(order).toEqual(['claim', 'create']);
  });

  it('再配送（権利が取れない）ならジョブを作らない', async () => {
    claimOnce.mockResolvedValue(false);

    await service.handleJobNotification(JOB_NAME, 'FAILED');

    expect(createTranscodeJob).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      'TranscoderJobRetryAlreadyClaimed',
      'handleFailed',
      expect.objectContaining({ claimPath: EXPECTED_CLAIM }),
    );
  });

  it('再配送を «失敗» にせず終える（throw すると Pub/Sub が再配送し続ける）', async () => {
    claimOnce.mockResolvedValue(false);

    await expect(
      service.handleJobNotification(JOB_NAME, 'FAILED'),
    ).resolves.toBeUndefined();
  });

  it('再配送で status を failed へ落とさない（リトライ中の動画を «失敗» にしない）', async () => {
    claimOnce.mockResolvedValue(false);

    await service.handleJobNotification(JOB_NAME, 'FAILED');

    expect(statusWrites()).toBe(0);
  });

  it('ジョブ作成に失敗したら権利を返す（返さないと永久に processing のまま残る）', async () => {
    createTranscodeJob.mockRejectedValue(new Error('quota exceeded'));

    await expect(
      service.handleJobNotification(JOB_NAME, 'FAILED'),
    ).rejects.toThrow('quota exceeded');

    expect(deleteFileIfExists).toHaveBeenCalledWith(EXPECTED_CLAIM);
  });

  it('AudioMissing でない失敗は権利を取りに行かない（従来どおり failed にする）', async () => {
    mockGetJob.mockResolvedValue([
      {
        ...audioMissingJob()[0],
        error: { message: 'something else went wrong' },
      },
    ]);

    await service.handleJobNotification(JOB_NAME, 'FAILED');

    expect(claimOnce).not.toHaveBeenCalled();
    expect(createTranscodeJob).not.toHaveBeenCalled();
    expect(statusWrites()).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      'TranscoderJobFailedPermanent',
      'handleFailed',
      expect.anything(),
    );
  });

  it('既に retry=1 のジョブが落ちたら、もう作らない', async () => {
    mockGetJob.mockResolvedValue([
      {
        ...audioMissingJob()[0],
        labels: {
          ...audioMissingJob()[0].labels,
          retry: '1',
          video_only: 'true',
        },
      },
    ]);

    await service.handleJobNotification(JOB_NAME, 'FAILED');

    expect(claimOnce).not.toHaveBeenCalled();
    expect(createTranscodeJob).not.toHaveBeenCalled();
  });
});

// api/src/core/storage/storage-claim-once.spec.ts
//
// #1599 **at-least-once の配送で «課金される処理» を二度実行しないための claim。**
//
// Cloud Tasks / Pub/Sub Push はハンドラが成功しても応答が届かなければ再実行する。
// 「やってから記録する」では守れない（記録の前に応答が落ちれば、次の配送でもう一度やる）。
// 先に権利を取り、取れた側だけが実行する。
//
// ここで固定したいのは «取り方» である。`fileExists()` してから書く形にすると
// その隙間に別の配送が入り込むので、**判定と書き込みが GCS 側で 1 つになっていること**
// （`ifGenerationMatch: 0`）をテストで釘付けにする。

import { Test, TestingModule } from '@nestjs/testing';
import { StorageService } from './storage.service';
import { STORAGE_CLIENT } from './storage.constants';
import { AppLoggerService } from '../logger/logger.service';
import { CloudTasksService } from '../cloud-tasks/cloud-tasks.service';
import { buildTranscodeRetryClaimPath } from './storage.utils';

jest.mock('src/core/config/env', () => ({
  env: {
    API_NODE_ENV: 'test',
    GCS_BUCKET_NAME: 'test-bucket',
    GCS_BUCKET_PUBLIC_NAME: 'test-bucket-public',
    CDN_HOST: 'cdn.example.com',
    GCP_PROJECT: 'test-project',
  },
}));

jest.mock('../config/env', () => ({
  env: {
    API_NODE_ENV: 'test',
    GCS_BUCKET_NAME: 'test-bucket',
    GCS_BUCKET_PUBLIC_NAME: 'test-bucket-public',
    CDN_HOST: 'cdn.example.com',
    GCP_PROJECT: 'test-project',
  },
}));

describe('#1599 StorageService.claimOnce', () => {
  let service: StorageService;
  let save: jest.Mock;
  let logger: {
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
  };

  beforeEach(async () => {
    save = jest.fn().mockResolvedValue(undefined);
    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: STORAGE_CLIENT,
          useValue: { bucket: () => ({ file: () => ({ save }) }) },
        },
        { provide: AppLoggerService, useValue: logger },
        { provide: CloudTasksService, useValue: {} },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  it('まだ誰も取っていなければ true を返す', async () => {
    await expect(service.claimOnce('a/b/.retry-1.claim')).resolves.toBe(true);
  });

  it('「まだ無いときだけ書く」を GCS 側の前提条件として渡す', async () => {
    // ここが緩むと «存在確認 → 書き込み» の隙間ができ、同時に来た 2 本が両方通る
    await service.claimOnce('a/b/.retry-1.claim');

    expect(save).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        preconditionOpts: { ifGenerationMatch: 0 },
        resumable: false,
      }),
    );
  });

  it('既に取られている（412）なら false を返し、例外にしない', async () => {
    save.mockRejectedValue(
      Object.assign(new Error('precondition'), { code: 412 }),
    );

    await expect(service.claimOnce('a/b/.retry-1.claim')).resolves.toBe(false);
  });

  it('412 以外（権限・ネットワーク）は握り潰さず投げる', async () => {
    // «取れなかった» と «取られていた» の区別が付かないまま false を返すと、
    // 呼び出し側が «誰かが実行済み» と誤解して処理を落とす
    save.mockRejectedValue(
      Object.assign(new Error('forbidden'), { code: 403 }),
    );

    await expect(service.claimOnce('a/b/.retry-1.claim')).rejects.toThrow(
      'forbidden',
    );
  });

  it('誰が何のために取ったかを claim ファイルへ残す（調査用）', async () => {
    await service.claimOnce('a/b/.retry-1.claim', {
      reason: 'transcode_retry',
    });

    const [body] = save.mock.calls[0] as [string];
    expect(JSON.parse(body)).toMatchObject({
      reason: 'transcode_retry',
      claimed_at: expect.any(String),
    });
  });
});

describe('#1599 buildTranscodeRetryClaimPath', () => {
  const OUT =
    'gs://test-bucket/test/transcoded-video/dish_media/media_path/rec-1/file/';

  it('出力先の prefix 直下に世代付きの claim を置く', () => {
    expect(buildTranscodeRetryClaimPath(OUT, 1)).toBe(
      'test/transcoded-video/dish_media/media_path/rec-1/file/.retry-1.claim',
    );
  });

  it('末尾に / が無くてもディレクトリとして扱う', () => {
    expect(buildTranscodeRetryClaimPath(OUT.replace(/\/$/, ''), 1)).toBe(
      'test/transcoded-video/dish_media/media_path/rec-1/file/.retry-1.claim',
    );
  });

  it('レコードが違えば claim も違う（別の動画のリトライを巻き込まない）', () => {
    const other = OUT.replace('rec-1', 'rec-2');
    expect(buildTranscodeRetryClaimPath(other, 1)).not.toBe(
      buildTranscodeRetryClaimPath(OUT, 1),
    );
  });

  it('世代が違えば claim も違う', () => {
    expect(buildTranscodeRetryClaimPath(OUT, 2)).not.toBe(
      buildTranscodeRetryClaimPath(OUT, 1),
    );
  });

  it('別バケットを指していたら落とす（取り違えは黙って二重ジョブになる）', () => {
    expect(() =>
      buildTranscodeRetryClaimPath('gs://someone-else/x/y/', 1),
    ).toThrow(/another bucket/);
  });

  it('gs:// 形式でなければ落とす', () => {
    expect(() =>
      buildTranscodeRetryClaimPath('https://example.com/x', 1),
    ).toThrow(/Invalid transcode outputUri/);
  });
});

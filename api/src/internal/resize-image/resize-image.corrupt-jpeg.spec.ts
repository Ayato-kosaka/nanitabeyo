// api/src/internal/resize-image/resize-image.corrupt-jpeg.spec.ts
//
// #514 【バグ】壊れた JPEG への耐性を実測で固定する
//
// 本番で観測された 2 パターン
//   - "VipsJpeg: Corrupt JPEG data: N extraneous bytes before marker 0xc4"
//   - "VipsJpeg: Invalid SOS parameters for sequential JPEG"
// はいずれも寛容なデコード（sharp の failOn: 'none'）で読み切れる。
// このテストは sharp をモックせず実物で検証する。
//

import { Test, TestingModule } from '@nestjs/testing';
import * as sharp from 'sharp';
import { ResizeImageService } from './resize-image.service';
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

/** ノイズ画像から十分な長さのスキャンデータを持つ正常な JPEG を作る */
async function buildValidJpeg(): Promise<Buffer> {
  const width = 400;
  const height = 400;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) {
    raw[i] = (i * 7919) % 256;
  }
  return await sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** 指定マーカーの直前に余分なバイトを挿入して "extraneous bytes before marker" を再現 */
function insertJunkBeforeMarker(
  jpeg: Buffer,
  marker: number,
  junkLength: number,
): Buffer {
  for (let i = 2; i < jpeg.length - 1; i++) {
    if (jpeg[i] === 0xff && jpeg[i + 1] === marker) {
      return Buffer.concat([
        jpeg.subarray(0, i),
        Buffer.alloc(junkLength, 0x5a),
        jpeg.subarray(i),
      ]);
    }
  }
  throw new Error(`marker 0x${marker.toString(16)} not found`);
}

/** SOS セグメントの Ss/Se を壊して "Invalid SOS parameters" を再現 */
function corruptSosParameters(jpeg: Buffer): Buffer {
  for (let i = 2; i < jpeg.length - 1; i++) {
    if (jpeg[i] === 0xff && jpeg[i + 1] === 0xda) {
      const segmentLength = jpeg.readUInt16BE(i + 2);
      const broken = Buffer.from(jpeg);
      broken[i + 2 + segmentLength - 3] = 0x05; // Ss
      broken[i + 2 + segmentLength - 2] = 0x02; // Se
      return broken;
    }
  }
  throw new Error('SOS marker not found');
}

describe('ResizeImageService - corrupt JPEG tolerance (real sharp)', () => {
  let service: ResizeImageService;
  let mockStorage: jest.Mocked<StorageService>;

  const dto = {
    table: 'restaurants',
    column: 'image_path',
    recordId: '557b343a-91f7-4acd-833e-03b6f1c38e5e',
    size: 64 as 64 | 256 | 512 | 1024,
    originalPath: 'production/google-maps/photo/corrupt.jpg',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResizeImageService,
        {
          provide: AppLoggerService,
          useValue: {
            debug: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
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
        { provide: PrismaService, useValue: { withTransaction: jest.fn() } },
      ],
    }).compile();

    service = module.get(ResizeImageService);
    mockStorage = module.get(StorageService);
    global.fetch = jest.fn();
  });

  const serveBuffer = (buffer: Buffer) => {
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: jest
        .fn()
        .mockResolvedValue(
          buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          ),
        ),
    } as any);
  };

  it('should reject the corrupt JPEG with sharp default options (baseline)', async () => {
    // 本番と同じ壊れ方が sharp のデフォルト設定では読めないことを先に固定する
    const corrupt = insertJunkBeforeMarker(await buildValidJpeg(), 0xc4, 1689);

    await expect(
      sharp(corrupt).rotate().resize(64).webp({ quality: 85 }).toBuffer(),
    ).rejects.toThrow(/extraneous bytes before marker 0xc4/);
  });

  it('should resize a JPEG with extraneous bytes before a marker', async () => {
    const corrupt = insertJunkBeforeMarker(await buildValidJpeg(), 0xc4, 1689);
    serveBuffer(corrupt);
    mockStorage.uploadFileAtPath.mockResolvedValue({
      path: 'resized/64.webp',
      signedUrl: 'https://example.com/resized',
    });

    const result = await service.resizeAndStoreImage(dto);

    expect(result.alreadyExisted).toBe(false);
    const uploaded = mockStorage.uploadFileAtPath.mock.calls[0][0].buffer;
    const meta = await sharp(uploaded).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(64);
  });

  it('should resize a JPEG with invalid SOS parameters', async () => {
    const corrupt = corruptSosParameters(await buildValidJpeg());
    serveBuffer(corrupt);
    mockStorage.uploadFileAtPath.mockResolvedValue({
      path: 'resized/64.webp',
      signedUrl: 'https://example.com/resized',
    });

    const result = await service.resizeAndStoreImage(dto);

    expect(result.alreadyExisted).toBe(false);
    const uploaded = mockStorage.uploadFileAtPath.mock.calls[0][0].buffer;
    expect((await sharp(uploaded).metadata()).format).toBe('webp');
  });

  it('should still fail permanently for input that is not an image at all', async () => {
    // 寛容化しても「そもそも画像でない」ものは救えない＝恒久失敗の経路は残る
    serveBuffer(Buffer.alloc(5000, 0x41));

    await expect(service.resizeAndStoreImage(dto)).rejects.toThrow();
  });
});

// api/src/v1/content-reports/content-reports.service.spec.ts
//
// #1514 (SAF-01) 投稿の通報で守りたい不変条件を固定する。
//
// ここで守るのは «オーナー確定仕様がコードのどこに現れているか» の 4 点:
//   1. 通報できるのは実在する投稿だけ（target_id に FK が無いので API が確かめるしかない）
//   2. 同一ユーザー × 同一投稿は 1 件（重複は 409 ではなく既存の受付番号を返す）
//   3. 通報者は body ではなく JWT の uid から埋める
//   4. 自由記述をログへ出さない（第三者の個人情報を含みうる）

// AppLoggerService が env.ts を読み込み、実環境変数が無いと import 時点で落ちるため差し替える
// （share-links.service.spec.ts と同じ手当て）
jest.mock('src/core/config/env', () => ({
  env: { NODE_ENV: 'test' },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate as validateDto } from 'class-validator';
import { CONTENT_REPORT_REASON_TEXT_MAX_LENGTH } from '@shared/v1/constants/contentReports';

import { ContentReportsService } from './content-reports.service';
import { ContentReportsRepository } from './content-reports.repository';
import { AppLoggerService } from '../../core/logger/logger.service';
import { CreateContentReportDto } from '@shared/v1/dto';

// ⚠️ 適当な繰り返し文字の UUID は class-validator の @IsUUID を通らない
// （variant のニブルが [89ab] でないため）。実データに近い v4 / v5 の形にする
const REPORTER = '11111111-1111-4111-8111-111111111111';
/** v5 の ID。dish_media には v5 が混ざっている（DTO 側でバージョンを固定しない理由の実例） */
const TARGET = '358cb297-da34-52b8-9f0c-6a1f7b2c3d4e';

/** Prisma の一意制約違反（P2002）を模した例外 */
const uniqueViolation = () =>
  Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

const dto = (
  overrides: Partial<CreateContentReportDto> = {},
): CreateContentReportDto =>
  ({
    targetType: 'dish_media',
    targetId: TARGET,
    reasonCode: 'spam',
    ...overrides,
  }) as CreateContentReportDto;

describe('ContentReportsService', () => {
  let service: ContentReportsService;
  let repository: {
    create: jest.Mock;
    findByReporterAndTarget: jest.Mock;
    existsTarget: jest.Mock;
  };
  let logger: {
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'report-1', status: 'pending' }),
      findByReporterAndTarget: jest.fn().mockResolvedValue(null),
      existsTarget: jest.fn().mockResolvedValue(true),
    };
    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentReportsService,
        { provide: ContentReportsRepository, useValue: repository },
        { provide: AppLoggerService, useValue: logger },
      ],
    }).compile();

    service = module.get(ContentReportsService);
  });

  describe('create', () => {
    it('受付番号（reportId）と pending を返す', async () => {
      const result = await service.create(dto(), REPORTER);

      expect(result).toEqual({
        reportId: 'report-1',
        status: 'pending',
        alreadyReported: false,
      });
    });

    it('通報者は JWT の uid から埋める（body の値では上書きできない）', async () => {
      // targetType / targetId / reasonCode / reasonText 以外は DTO に無いが、
      // 万一 body に reporterUserId が混ざっても ValidationPipe(whitelist) が落とす。
      // ここでは Service が «引数の userId» しか使わないことを固定する
      await service.create(
        {
          ...dto(),
          reporterUserId: 'attacker',
        } as unknown as CreateContentReportDto,
        REPORTER,
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ reporterUserId: REPORTER }),
      );
    });

    it('存在しない投稿は 404（target_id に FK が無いので API が確かめる）', async () => {
      repository.existsTarget.mockResolvedValue(false);

      await expect(service.create(dto(), REPORTER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('同じ投稿への 2 回目は新規作成せず、既存の受付番号を返す（冪等）', async () => {
      repository.create.mockRejectedValue(uniqueViolation());
      repository.findByReporterAndTarget.mockResolvedValue({
        id: 'report-1',
        status: 'pending',
      });

      const result = await service.create(
        dto({ reasonCode: 'sexual' }),
        REPORTER,
      );

      // 409 にしない: ユーザーには「受け付けました」としか見せず、
      // «自分が通報済みかどうか» をステータスコードから読めないようにする
      expect(result).toEqual({
        reportId: 'report-1',
        status: 'pending',
        alreadyReported: true,
      });
    });

    it('一意制約に当たったのに既存行を引けないときは握り潰さず投げる', async () => {
      const error = uniqueViolation();
      repository.create.mockRejectedValue(error);
      repository.findByReporterAndTarget.mockResolvedValue(null);

      await expect(service.create(dto(), REPORTER)).rejects.toBe(error);
    });

    it('一意制約以外の失敗はそのまま投げる（成功に化けさせない）', async () => {
      const error = Object.assign(new Error('db is down'), { code: 'P1001' });
      repository.create.mockRejectedValue(error);

      await expect(service.create(dto(), REPORTER)).rejects.toBe(error);
      expect(repository.findByReporterAndTarget).not.toHaveBeenCalled();
    });

    it('空白だけの自由記述は null として保存する', async () => {
      await service.create(dto({ reasonText: '   ' }), REPORTER);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ reasonText: null }),
      );
    });

    it('自由記述は前後の空白を落として保存する', async () => {
      await service.create(
        dto({ reasonText: '  この写真に他人の顔が写っています  ' }),
        REPORTER,
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          reasonText: 'この写真に他人の顔が写っています',
        }),
      );
    });

    it('自由記述をログへ出さない（第三者の個人情報を含みうる）', async () => {
      const secret = '通報者が書いた第三者の氏名と電話番号';
      await service.create(dto({ reasonText: secret }), REPORTER);

      const logged = JSON.stringify(logger.log.mock.calls);
      expect(logged).not.toContain(secret);
      // 集計に要る理由コードと「本文の有無」までは残す
      expect(logger.log).toHaveBeenCalledWith(
        'ContentReportCreated',
        'create',
        expect.objectContaining({ reasonCode: 'spam', hasReasonText: true }),
      );
    });
  });
});

/**
 * DTO 側の検証。
 *
 * `content_reports` の CHECK 制約とアプリの定数が同じ集合であることは
 * migration のコメントで縛っているが、**未知の値が API に入らない**ことは
 * DTO でしか担保できない。ここが崩れると 201 を返してから INSERT が落ちる。
 */
describe('CreateContentReportDto', () => {
  const validate = async (payload: Record<string, unknown>) => {
    const instance = plainToInstance(CreateContentReportDto, payload);
    const errors = await validateDto(instance);
    return errors.map((e) => e.property);
  };

  it('選択肢どおりの通報を受け付ける', async () => {
    expect(
      await validate({
        targetType: 'dish_media',
        targetId: TARGET,
        reasonCode: 'privacy',
      }),
    ).toEqual([]);
  });

  it('自由記述は任意（未指定でも通る）', async () => {
    expect(
      await validate({
        targetType: 'dish_media',
        targetId: TARGET,
        reasonCode: 'other',
      }),
    ).toEqual([]);
  });

  it('未知の理由コードを弾く', async () => {
    expect(
      await validate({
        targetType: 'dish_media',
        targetId: TARGET,
        reasonCode: 'whatever',
      }),
    ).toContain('reasonCode');
  });

  it('対象外の種別（レビュー・ユーザー）を弾く', async () => {
    // オーナー確定仕様: 通報できるのは投稿だけ。dish_reviews / users は対象外
    expect(
      await validate({
        targetType: 'dish_reviews',
        targetId: TARGET,
        reasonCode: 'spam',
      }),
    ).toContain('targetType');
    expect(
      await validate({
        targetType: 'users',
        targetId: TARGET,
        reasonCode: 'spam',
      }),
    ).toContain('targetType');
  });

  it('UUID でない targetId を弾く', async () => {
    expect(
      await validate({
        targetType: 'dish_media',
        targetId: 'not-a-uuid',
        reasonCode: 'spam',
      }),
    ).toContain('targetId');
  });

  it('1000 文字を超える自由記述を弾く（DB の CHECK と同じ上限）', async () => {
    expect(
      await validate({
        targetType: 'dish_media',
        targetId: TARGET,
        reasonCode: 'other',
        reasonText: 'あ'.repeat(CONTENT_REPORT_REASON_TEXT_MAX_LENGTH + 1),
      }),
    ).toContain('reasonText');

    expect(
      await validate({
        targetType: 'dish_media',
        targetId: TARGET,
        reasonCode: 'other',
        reasonText: 'あ'.repeat(CONTENT_REPORT_REASON_TEXT_MAX_LENGTH),
      }),
    ).toEqual([]);
  });
});

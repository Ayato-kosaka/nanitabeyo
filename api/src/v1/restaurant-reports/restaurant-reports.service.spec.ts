// api/src/v1/restaurant-reports/restaurant-reports.service.spec.ts
//
// #1933 店舗情報の «この情報が違う» 報告で守りたい不変条件を固定する。
//
// ここで守るのは «オーナーと合意した受け入れ条件がコードのどこに現れているか»:
//   条件 5  報告しても `restaurants` を更新しない（このサービスは店を 1 行も書かない）
//   条件 6  `pending` として残る
//   条件 10 同一ユーザー × 同一店 × 同一項目は 1 件（二重は 409 ではなく既存の受付番号）
//   共通    報告者は body ではなく JWT の uid から埋める
//   共通    ユーザーの自由入力（proposedValue）をログへ出さない
//
// ⚠️ **項目の一覧を写経しないこと。** 報告できる項目は
// `RESTAURANT_REPORT_FIELDS`（shared）が正で、この spec はそこから引いて全項目を回す。
// 配列を書き写すと、項目を増やしたときに «一部の項目しか検証していない» 状態へ静かに戻る。

// AppLoggerService が env.ts を読み込み、実環境変数が無いと import 時点で落ちるため差し替える
// （content-reports.service.spec.ts と同じ手当て）
jest.mock('src/core/config/env', () => ({
  env: { NODE_ENV: 'test' },
}));

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  type PipeTransform,
} from '@nestjs/common';
import { PIPES_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate as validateDto } from 'class-validator';
import {
  RESTAURANT_REPORT_FIELDS,
  RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE,
  RESTAURANT_REPORT_PROPOSED_VALUE_MAX_LENGTH,
} from '@shared/v1/constants/restaurantReports';

import { RestaurantReportsController } from './restaurant-reports.controller';
import { RestaurantReportsService } from './restaurant-reports.service';
import { RestaurantReportsRepository } from './restaurant-reports.repository';
import { AppLoggerService } from '../../core/logger/logger.service';
import { CreateRestaurantReportDto } from '@shared/v1/dto';

// ⚠️ 適当な繰り返し文字の UUID は class-validator の @IsUUID を通らない
// （variant のニブルが [89ab] でないため）。実データに近い形にする
const REPORTER = '11111111-1111-4111-8111-111111111111';
const RESTAURANT = '22222222-2222-4222-8222-222222222222';

/** 値を伴う項目（`closed` 以外）。定数から引く */
const FIELDS_WITH_VALUE = RESTAURANT_REPORT_FIELDS.filter(
  (f) => !RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE.includes(f),
);

/** Prisma の一意制約違反（P2002）を模した例外 */
const uniqueViolation = () =>
  Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

const dto = (
  overrides: Partial<CreateRestaurantReportDto> = {},
): CreateRestaurantReportDto =>
  ({
    restaurantId: RESTAURANT,
    field: 'name',
    proposedValue: '本当の店名',
    ...overrides,
  }) as CreateRestaurantReportDto;

describe('RestaurantReportsService', () => {
  let service: RestaurantReportsService;
  let repository: {
    create: jest.Mock;
    findByReporterAndTarget: jest.Mock;
    existsRestaurant: jest.Mock;
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
      existsRestaurant: jest.fn().mockResolvedValue(true),
    };
    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestaurantReportsService,
        { provide: RestaurantReportsRepository, useValue: repository },
        { provide: AppLoggerService, useValue: logger },
      ],
    }).compile();

    service = module.get(RestaurantReportsService);
  });

  // 項目ごとに規則を分けない。同じ検証を全項目へ流して固定する
  describe.each(RESTAURANT_REPORT_FIELDS)('create（field: %s）', (field) => {
    const withoutValue = RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE.includes(field);
    const d = (overrides: Partial<CreateRestaurantReportDto> = {}) =>
      dto({ field, proposedValue: withoutValue ? undefined : '正しい値', ...overrides });

    it('受付番号（reportId）と pending を返す（受け入れ条件 6）', async () => {
      await expect(service.create(d(), REPORTER)).resolves.toEqual({
        reportId: 'report-1',
        status: 'pending',
        alreadyReported: false,
      });
    });

    it('報告者は引数の uid で保存する（body の値を使わない）', async () => {
      await service.create(d(), REPORTER);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ reporterUserId: REPORTER, field }),
      );
    });

    it('存在しない店は 404（FK の P2003 を 500 にしない）', async () => {
      repository.existsRestaurant.mockResolvedValue(false);
      await expect(service.create(d(), REPORTER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('二重報告は 409 ではなく既存の受付番号を返す（受け入れ条件 10）', async () => {
      repository.create.mockRejectedValue(uniqueViolation());
      repository.findByReporterAndTarget.mockResolvedValue({
        id: 'report-existing',
        status: 'rejected',
      });

      await expect(service.create(d(), REPORTER)).resolves.toEqual({
        reportId: 'report-existing',
        status: 'rejected',
        alreadyReported: true,
      });
    });

    it('ログにユーザーの自由入力を載せない', async () => {
      await service.create(d({ proposedValue: withoutValue ? undefined : '田中太郎 090-0000-0000' }), REPORTER);
      const payloads = JSON.stringify([
        ...logger.log.mock.calls,
        ...logger.warn.mock.calls,
      ]);
      expect(payloads).not.toContain('田中太郎');
      expect(payloads).not.toContain('090-0000-0000');
    });
  });

  describe('«正しい値» の扱い', () => {
    it.each(FIELDS_WITH_VALUE)(
      '%s は前後の空白を落として保存する',
      async (field) => {
        await service.create(dto({ field, proposedValue: '  本当の値  ' }), REPORTER);
        expect(repository.create).toHaveBeenCalledWith(
          expect.objectContaining({ proposedValue: '本当の値' }),
        );
      },
    );

    it.each(FIELDS_WITH_VALUE)('%s は空白だけの入力を 400 で断る', async (field) => {
      await expect(
        service.create(dto({ field, proposedValue: '   ' }), REPORTER),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it.each(FIELDS_WITH_VALUE)('%s は値が無ければ 400 で断る', async (field) => {
      await expect(
        service.create(dto({ field, proposedValue: undefined }), REPORTER),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it.each(RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE)(
      '%s は値が送られてきても NULL にする（判定に使えない値を残さない）',
      async (field) => {
        await expect(
          service.create(dto({ field, proposedValue: 'よく分からない値' }), REPORTER),
        ).resolves.toMatchObject({ alreadyReported: false });
        expect(repository.create).toHaveBeenCalledWith(
          expect.objectContaining({ proposedValue: null }),
        );
      },
    );
  });

  // ⚠️ ここは «サービスが店を書かない» ことを構造で固定する。
  // Repository のモックに restaurants を触る口が無い（existsRestaurant だけ）ので、
  // 書こうとすれば TypeError で落ちる。将来 Repository へ更新の口を足しても、
  // この spec が «呼ばれていないこと» を見る
  it('報告しても店の情報を更新しない（受け入れ条件 5）', async () => {
    await service.create(dto(), REPORTER);
    expect(Object.keys(repository)).toEqual([
      'create',
      'findByReporterAndTarget',
      'existsRestaurant',
    ]);
  });

  describe('CreateRestaurantReportDto', () => {
    const validateBody = async (body: Record<string, unknown>) =>
      validateDto(plainToInstance(CreateRestaurantReportDto, body));

    it('未知の項目は 400（DB の CHECK 制約まで行かせない）', async () => {
      const errors = await validateBody({
        restaurantId: RESTAURANT,
        field: 'phone_number',
      });
      expect(errors.map((e) => e.property)).toContain('field');
    });

    it.each(RESTAURANT_REPORT_FIELDS)('%s は通る', async (field) => {
      const errors = await validateBody({ restaurantId: RESTAURANT, field });
      expect(errors).toEqual([]);
    });

    it('店 ID が UUID でなければ 400', async () => {
      const errors = await validateBody({ restaurantId: 'not-a-uuid', field: 'name' });
      expect(errors.map((e) => e.property)).toContain('restaurantId');
    });

    it('«正しい値» は上限を超えると 400（DB の CHECK と同じ長さ）', async () => {
      const errors = await validateBody({
        restaurantId: RESTAURANT,
        field: 'name',
        proposedValue: 'あ'.repeat(RESTAURANT_REPORT_PROPOSED_VALUE_MAX_LENGTH + 1),
      });
      expect(errors.map((e) => e.property)).toContain('proposedValue');
    });

    it('上限ちょうどは通る', async () => {
      const errors = await validateBody({
        restaurantId: RESTAURANT,
        field: 'name',
        proposedValue: 'あ'.repeat(RESTAURANT_REPORT_PROPOSED_VALUE_MAX_LENGTH),
      });
      expect(errors).toEqual([]);
    });

    /**
     * ⚠️ **`plainToInstance` だけで確かめてはいけない。** 素の変換は未知のプロパティを
     * そのまま載せるので «なりすましの口が無い» の証明にならない（実際に一度そう書いて
     * 落とした）。守っているのは Controller の `ValidationPipe({ whitelist: true })` で、
     * ここでは **Controller が実際に付けているパイプを Nest のメタデータから取り出して**
     * 通す。オプションをこの spec へ書き写すと、Controller 側で `whitelist` を落としても
     * 緑のままになる。
     */
    it('報告者を body で受け取る口が無い（Controller のパイプが落とす）', async () => {
      const pipes: PipeTransform[] = Reflect.getMetadata(
        PIPES_METADATA,
        RestaurantReportsController.prototype.create,
      );
      expect(pipes).toHaveLength(1);

      const body = await pipes[0]!.transform(
        {
          restaurantId: RESTAURANT,
          field: 'name',
          reporterUserId: 'someone-else',
        },
        { type: 'body', metatype: CreateRestaurantReportDto },
      );

      expect(body).not.toHaveProperty('reporterUserId');
      expect(body).toMatchObject({ restaurantId: RESTAURANT, field: 'name' });
    });
  });
});

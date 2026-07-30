// api/src/v1/logs/frontend-log-batch.pipe.spec.ts
//
// #1079 【設計】バッチ内 1 件の不正で全体を棄却しない（部分受理）検証 pipe のテスト
//

import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import {
  CreateFrontendLogBatchDto,
  CreateFrontendLogDto,
} from '@shared/v1/dto';
import {
  FrontendLogBatchValidationPipe,
  REJECTED_ROOT_FIELD,
  ValidatedFrontendLogBatch,
} from './frontend-log-batch.pipe';

const BODY_METADATA: ArgumentMetadata = {
  type: 'body',
  metatype: CreateFrontendLogBatchDto,
  data: undefined,
};

const buildLog = (eventName: string, overrides: Record<string, any> = {}) => ({
  event_name: eventName,
  path_name: '/test',
  payload: { foo: 'bar' },
  error_level: 'log',
  created_at: '2024-01-01T00:00:00.000Z',
  created_app_version: '1.0.0',
  created_commit_id: 'abc123',
  ...overrides,
});

describe('FrontendLogBatchValidationPipe', () => {
  let pipe: FrontendLogBatchValidationPipe;

  const transformBody = (value: unknown): Promise<ValidatedFrontendLogBatch> =>
    pipe.transform(value, BODY_METADATA) as Promise<ValidatedFrontendLogBatch>;

  beforeEach(() => {
    pipe = new FrontendLogBatchValidationPipe();
  });

  it('A1: accepts all items when every element is valid', async () => {
    const result = await transformBody({
      logs: [buildLog('a'), buildLog('b'), buildLog('c')],
    });

    expect(result.accepted).toHaveLength(3);
    expect(result.rejected).toEqual([]);
  });

  it('A2: accepts the remaining items when one element is invalid (#1076 の実データ相当)', async () => {
    // error_level が不正な要素を 1 つ混ぜる（#1078 で created_commit_id 欠落は妥当になったため）
    const result = await transformBody({
      logs: [
        buildLog('a'),
        buildLog('b', { error_level: 'unknown' }),
        buildLog('c'),
      ],
    });

    expect(result.accepted).toHaveLength(2);
    expect(result.accepted.map((l) => l.event_name)).toEqual(['a', 'c']);
    expect(result.rejected).toEqual([
      { index: 1, fields: ['error_level'], constraints: ['isIn'] },
    ]);
  });

  it('A2-b: #1078 により created_commit_id / created_app_version の欠落は棄却されない', async () => {
    const withoutCommitId = buildLog('a');
    delete (withoutCommitId as any).created_commit_id;
    delete (withoutCommitId as any).created_app_version;

    const result = await transformBody({ logs: [withoutCommitId] });

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].created_commit_id).toBeUndefined();
  });

  it('A3: 100 件中 99 件が不正でも例外を投げず 1 件受理する', async () => {
    const logs = Array.from({ length: 100 }, (_, i) =>
      i === 0 ? buildLog('valid') : buildLog(`e_${i}`, { error_level: 'nope' }),
    );

    const result = await transformBody({ logs });

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(99);
  });

  it('A4: 全件不正でも例外を投げない（201 になる）', async () => {
    const logs = Array.from({ length: 3 }, (_, i) =>
      buildLog(`e_${i}`, { error_level: 'nope' }),
    );

    const result = await transformBody({ logs });

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(3);
  });

  it('A5: whitelist が維持され、未知プロパティは除去される', async () => {
    const result = await transformBody({
      logs: [buildLog('a', { __evil: 1 })],
    });

    expect(result.accepted).toHaveLength(1);
    expect('__evil' in result.accepted[0]).toBe(false);
  });

  it('A6: transform が維持され、要素は CreateFrontendLogDto のインスタンスになる', async () => {
    const result = await transformBody({ logs: [buildLog('a')] });

    expect(result.accepted[0]).toBeInstanceOf(CreateFrontendLogDto);
  });

  it('A7: 暗黙変換が維持される（created_app_version: 100 → "100"）', async () => {
    const result = await transformBody({
      logs: [buildLog('a', { created_app_version: 100 })],
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].created_app_version).toBe('100');
  });

  it.each([
    ['null', null],
    ['string', 'x'],
    ['array', []],
    ['number', 42],
  ])(
    'A8: 非オブジェクト要素(%s)は例外を投げず棄却される',
    async (_label, bad) => {
      const result = await transformBody({ logs: [buildLog('a'), bad] });

      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].event_name).toBe('a');
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].index).toBe(1);
      // null / プリミティブ / 配列のいずれも accepted に混入しない
      expect(
        result.accepted.every((l) => l instanceof CreateFrontendLogDto),
      ).toBe(true);
    },
  );

  it('A8-b: null 要素は (root) / isObject として要約される', async () => {
    const result = await transformBody({ logs: [null] });

    expect(result.rejected).toEqual([
      { index: 0, fields: [REJECTED_ROOT_FIELD], constraints: ['isObject'] },
    ]);
  });

  describe('A9: 封筒起因は従来どおり 400', () => {
    it.each([
      ['empty array', { logs: [] }],
      [
        'over max size',
        { logs: Array.from({ length: 101 }, () => buildLog('a')) },
      ],
      ['not an array', { logs: 'x' }],
      ['missing logs', {}],
    ])('%s', async (_label, body) => {
      await expect(transformBody(body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  it('A10: 棄却要約にログ本文の値が入らない', async () => {
    const sentinel = 'pii-sentinel@example.com';
    const result = await transformBody({
      logs: [
        buildLog('a', {
          error_level: 'nope',
          payload: { email: sentinel },
          path_name: `/user/${sentinel}`,
        }),
      ],
    });

    expect(JSON.stringify(result.rejected)).not.toContain(sentinel);
    expect(JSON.stringify(result.rejected)).not.toContain('payload');
  });

  describe('指摘1 の回帰: route-scoped pipe は handler の全パラメータに適用される', () => {
    it.each([
      ['custom', { id: 'user-1', isAnonymous: false, role: 'authenticated' }],
      ['param', 'some-param'],
      ['query', { q: '1' }],
    ])(
      'metadata.type が %s のときは値をそのまま返す（封筒検証しない）',
      async (type, value) => {
        const result = await pipe.transform(value, {
          type: type as ArgumentMetadata['type'],
          metatype: undefined,
          data: undefined,
        });

        expect(result).toBe(value);
      },
    );
  });
});

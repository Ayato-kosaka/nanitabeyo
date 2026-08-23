// api/src/v1/locations/locations.autocomplete-jp-restriction.integration.spec.ts
//
// #1502 (SEA-01) Autocomplete 候補の日本国内制限を、HTTP 入口から Google Places への
// 送信ボディまで通しで固定する統合テスト。
//
// 【なぜ統合テストか】
// この変更は「NestJS API が Google Places API (New) へ送る JSON に
// includedRegionCodes: ['jp'] が乗っていること」であり、その観測点は
// **API と Google の間** にしか無い。UI(検索フォーム → 候補リスト)は
// API のレスポンスをそのまま描画するだけで、制限が効いているかどうかを
// 画面から区別できない(制限前も制限後も「候補が並ぶ」画面は同じ)。
// したがって e2e ではなく、HTTP → Controller → Service → ExternalApiService →
// fetch までを実物で繋ぎ、fetch だけを差し替えた統合テストで固定する。
//
// locations.service.spec.ts の単体テストは ExternalApiService をモックするため
// 「Service が何を渡したか」までしか見ない。ここでは ExternalApiService を実物に
// することで、リクエストボディが実際に JSON へ載って Google のエンドポイントへ
// 出ていくところまでを保証する(封筒の詰め替えで落ちる事故を検知できる)。

jest.mock('src/core/config/env', () => ({
  env: {
    API_COMMIT_ID: 'test-commit',
    API_NODE_ENV: 'test',
    GOOGLE_PLACE_API_KEY: 'test-google-place-api-key',
  },
}));

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
// api/tsconfig.json は esModuleInterop 無効のため、default import では実体を掴めない
import * as request from 'supertest';

import { AppLoggerService } from '../../core/logger/logger.service';
import { AuthAnonGuard } from '../../core/auth/auth.guard';
import { ExternalApiService } from '../../core/external-api/external-api.service';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

/** Places Autocomplete (New) のエンドポイント */
const PLACES_AUTOCOMPLETE_ENDPOINT =
  'https://places.googleapis.com/v1/places:autocomplete';

/** Google が返す suggestion 1 件分を組み立てる */
const buildSuggestion = (
  placeId: string,
  mainText: string,
  secondaryText: string,
) => ({
  placePrediction: {
    placeId,
    text: { text: `${mainText} ${secondaryText}` },
    structuredFormat: {
      mainText: { text: mainText },
      secondaryText: { text: secondaryText },
    },
    types: ['establishment'],
  },
});

describe('GET /v1/locations/autocomplete (integration) — 日本国内制限 #1502', () => {
  let app: INestApplication;
  let mockFetch: jest.Mock;

  beforeEach(async () => {
    const mockLoggerService = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
      externalApi: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [LocationsController],
      providers: [
        LocationsService,
        // ExternalApiService は実物。ここをモックすると
        // 「送信ボディに載ったか」を見られなくなる
        ExternalApiService,
        { provide: AppLoggerService, useValue: mockLoggerService },
      ],
    })
      // 認証は本テストの対象外。匿名 JWT の検証まで含めると Supabase の
      // 秘密鍵が要るため、ガードだけ素通しに差し替える
      .overrideGuard(AuthAnonGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        suggestions: [
          buildSuggestion('place-shibuya-1', '渋谷駅', '日本、東京都渋谷区'),
        ],
      }),
      text: jest.fn().mockResolvedValue(''),
      clone: jest.fn().mockReturnThis(),
    });
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  /** 直近の fetch 呼び出しが Google へ送った JSON ボディを取り出す */
  const sentPayload = (): Record<string, unknown> => {
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [
      string,
      { method: string; body: string },
    ];
    expect(url).toBe(PLACES_AUTOCOMPLETE_ENDPOINT);
    expect(init.method).toBe('POST');
    return JSON.parse(init.body);
  };

  it('Google Places へ送るボディに includedRegionCodes: ["jp"] が載る', async () => {
    // #1502 【テスト】これが本 PR の本体。日本国外の候補を選べてしまうと、
    // 地点は確定するのに dish-categories.service.ts の国単位ホワイトリスト
    // ('region:country:JP' のみ)にどのゲートも当たらず、レコメンドが
    // 0 件 / insufficient_candidates で行き止まりになる。
    await request(app.getHttpServer())
      .get('/v1/locations/autocomplete')
      .query({ q: '渋谷', languageCode: 'ja' })
      .expect(200);

    expect(sentPayload()).toMatchObject({ includedRegionCodes: ['jp'] });
  });

  it('日本国外を指す検索語でも includedRegionCodes は落ちない', async () => {
    // 【テスト】制限は入力語に依存しない。国外地名で問い合わせても
    // リクエスト自体が日本限定であること(アプリ側の後段フィルタではないこと)。
    await request(app.getHttpServer())
      .get('/v1/locations/autocomplete')
      .query({ q: 'Paris', languageCode: 'en' })
      .expect(200);

    expect(sentPayload()).toMatchObject({
      input: 'Paris',
      includedRegionCodes: ['jp'],
    });
  });

  it('既存のリクエスト項目(input / languageCode / sessionToken)を壊さない', async () => {
    // 【テスト】includedRegionCodes の追加で既存項目が欠落していないこと。
    // sessionToken が落ちると Autocomplete の課金セッションが成立しなくなる。
    await request(app.getHttpServer())
      .get('/v1/locations/autocomplete')
      .query({ q: '新宿', languageCode: 'ja', sessionToken: 'session-abc' })
      .expect(200);

    expect(sentPayload()).toMatchObject({
      input: '新宿',
      languageCode: 'ja',
      sessionToken: 'session-abc',
      includedRegionCodes: ['jp'],
    });
  });

  it('CLDR 地域コードは小文字 2 文字 1 件だけを送る', async () => {
    // 【テスト】includedRegionCodes は CLDR 地域コード(最大 15 件)。
    // 'JP' や 'jpn' のような表記揺れを入れると Google が INVALID_ARGUMENT を返す。
    // 表記が変わったらここで落とす。
    await request(app.getHttpServer())
      .get('/v1/locations/autocomplete')
      .query({ q: '渋谷', languageCode: 'ja' })
      .expect(200);

    const regionCodes = sentPayload().includedRegionCodes as string[];
    expect(regionCodes).toEqual(['jp']);
    expect(regionCodes.every((code) => /^[a-z]{2}$/.test(code))).toBe(true);
  });

  it('日本限定になったレスポンスはそのままクライアントへ返る', async () => {
    // 【テスト】制限はリクエスト側で完結しており、レスポンスを
    // サーバー側で追加フィルタしていないこと(Google が返した候補が
    // そのまま UI へ届く)。
    const response = await request(app.getHttpServer())
      .get('/v1/locations/autocomplete')
      .query({ q: '渋谷', languageCode: 'ja' })
      .expect(200);

    expect(response.body).toEqual([
      {
        place_id: 'place-shibuya-1',
        text: '渋谷駅 日本、東京都渋谷区',
        mainText: '渋谷駅',
        secondaryText: '日本、東京都渋谷区',
        types: ['establishment'],
      },
    ]);
  });
});

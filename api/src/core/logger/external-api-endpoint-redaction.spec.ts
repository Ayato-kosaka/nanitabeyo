// api/src/core/logger/external-api-endpoint-redaction.spec.ts
//
// #1599 **外部 API のエンドポイントを、クエリ文字列ごとログへ残さない。**
//
// `external_api_logs` は BigQuery へ蓄積され、error-triage 経由で
// **公開リポジトリの Issue へも転載される**。以下が実際に入っていた:
//
//   - Google Custom Search: `?key=<APIキー>&cx=<エンジンID>&q=<検索語>`
//   - Google 逆ジオコーディング: `?key=<APIキー>&latlng=<ユーザーの現在地>`
//
// 呼び出し側で 1 つずつ直す方式は「次に追加された呼び出しが漏らす」ので採らない。
// **唯一の出口である logger でクエリを丸ごと落とす。**

import { AppLoggerService, sanitizeEndpointForLog } from './logger.service';

describe('#1599 sanitizeEndpointForLog', () => {
  it('Google Custom Search の API キー・エンジン ID・検索語を落とす', () => {
    const leaked =
      'https://www.googleapis.com/customsearch/v1?key=AIza-SECRET-KEY&cx=ENGINE-ID&q=%E3%83%A9%E3%83%BC%E3%83%A1%E3%83%B3';

    const safe = sanitizeEndpointForLog(leaked);

    expect(safe).toBe('https://www.googleapis.com/customsearch/v1');
    expect(safe).not.toContain('AIza-SECRET-KEY');
    expect(safe).not.toContain('ENGINE-ID');
    expect(safe).not.toContain('q=');
  });

  it('逆ジオコーディングの API キーと緯度経度（現在地）を落とす', () => {
    const leaked =
      'https://maps.googleapis.com/maps/api/geocode/json?latlng=35.681236%2C139.767125&key=AIza-SECRET-KEY&language=ja';

    const safe = sanitizeEndpointForLog(leaked);

    expect(safe).toBe('https://maps.googleapis.com/maps/api/geocode/json');
    expect(safe).not.toContain('AIza-SECRET-KEY');
    // 現在地が残らないこと。ここが残ると «誰がどこに居たか» がログに溜まる
    expect(safe).not.toContain('35.681236');
    expect(safe).not.toContain('139.767125');
  });

  it('セッショントークンも落ちる', () => {
    const safe = sanitizeEndpointForLog(
      'https://places.googleapis.com/v1/places/PLACE_ID?languageCode=ja&sessionToken=abc-123',
    );
    expect(safe).toBe('https://places.googleapis.com/v1/places/PLACE_ID');
    expect(safe).not.toContain('abc-123');
  });

  it('フラグメントも落とす', () => {
    expect(sanitizeEndpointForLog('https://example.test/a#secret')).toBe(
      'https://example.test/a',
    );
  });

  it('クエリの無い URL はそのまま（どの API を叩いたかは残す）', () => {
    expect(sanitizeEndpointForLog('https://api.anthropic.com/v1/messages')).toBe(
      'https://api.anthropic.com/v1/messages',
    );
  });

  // URL として壊れていても、`?` 以降は落とす（保険）
  it.each([
    ['URL でない文字列', 'not a url?key=SECRET', 'not a url'],
    ['空文字', '', ''],
  ])('%s', (_label, input, expected) => {
    expect(sanitizeEndpointForLog(input)).toBe(expected);
  });

  it.each([null, undefined])('%p でも throw しない', (input) => {
    expect(sanitizeEndpointForLog(input as unknown as string)).toBe('');
  });
});

// ヘルパー単体が正しいだけでは足りない。**実際に吐かれる 1 行**に鍵が無いことを見る。
describe('#1599 externalApi() が実際に出力する行', () => {
  it('API キーと現在地が 1 文字も含まれない', async () => {
    const emitted: string[] = [];
    const spy = jest
      .spyOn(console, 'log')
      .mockImplementation((line: unknown) => {
        emitted.push(String(line));
      });

    try {
      const logger = new AppLoggerService({
        get: () => undefined,
      } as never);

      await logger.externalApi({
        api_name: 'Google Geocoding API',
        endpoint:
          'https://maps.googleapis.com/maps/api/geocode/json?latlng=35.681236%2C139.767125&key=AIza-SECRET-KEY',
        method: 'GET',
        request_payload: {},
        response_payload: null,
        status_code: 200,
        response_time_ms: 12,
        function_name: 'callReverseGeocoding',
        error_message: null,
      } as never);
    } finally {
      spy.mockRestore();
    }

    expect(emitted).toHaveLength(1);
    const line = emitted[0];

    expect(line).not.toContain('AIza-SECRET-KEY');
    expect(line).not.toContain('35.681236');

    // どの API を叩いたかは残っていること（消しすぎていない）
    const parsed = JSON.parse(line);
    expect(parsed.endpoint).toBe(
      'https://maps.googleapis.com/maps/api/geocode/json',
    );
    expect(parsed.api_name).toBe('Google Geocoding API');
  });
});

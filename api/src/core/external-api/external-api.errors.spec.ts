// api/src/core/external-api/external-api.errors.spec.ts
//
// #1196 上流クォータ枯渇の判定。
// このモジュールは外部を一切 import しないので、api/.env が無い環境でも単体で回せる。

import {
  ExternalApiQuotaExceededError,
  isQuotaExceededUpstreamResponse,
} from './external-api.errors';

describe('#1196 isQuotaExceededUpstreamResponse', () => {
  it('429 はクォータ枯渇として扱う（Places API (New) の RESOURCE_EXHAUSTED）', () => {
    expect(
      isQuotaExceededUpstreamResponse(
        429,
        "Quota exceeded for quota metric 'SearchTextRequest' and limit 'SearchTextRequest per day'",
      ),
    ).toBe(true);
  });

  it('本文が読めなくても 429 だけで判定できる（text() が失敗しても分類が壊れない）', () => {
    expect(isQuotaExceededUpstreamResponse(429, '')).toBe(true);
    expect(isQuotaExceededUpstreamResponse(429, undefined)).toBe(true);
  });

  it('403 は本文に RESOURCE_EXHAUSTED があるときだけクォータ扱い', () => {
    expect(
      isQuotaExceededUpstreamResponse(403, 'status: RESOURCE_EXHAUSTED'),
    ).toBe(true);
    expect(isQuotaExceededUpstreamResponse(403, 'PERMISSION_DENIED')).toBe(
      false,
    );
  });

  // ★ ここが緩むと、我々のバグ（壊れたリクエスト）が「想定内のクォータ枯渇」として
  //   warn + 429 に化け、error-triage からも消える。
  it.each([400, 401, 404, 500, 502, 503])(
    '%i はクォータ枯渇として扱わない',
    (status) => {
      expect(isQuotaExceededUpstreamResponse(status, 'Quota exceeded')).toBe(
        false,
      );
    },
  );
});

describe('#1196 ExternalApiQuotaExceededError', () => {
  it('instanceof で判定できる（呼び出し側が message の文字列一致に頼らないため）', () => {
    const error = new ExternalApiQuotaExceededError({
      apiName: 'Google Places Text Search API',
      upstreamStatus: 429,
      message: 'Google Places Text Search API request failed: 429',
    });

    expect(error).toBeInstanceOf(ExternalApiQuotaExceededError);
    expect(error).toBeInstanceOf(Error);
    expect(error.upstreamStatus).toBe(429);
    expect(error.apiName).toBe('Google Places Text Search API');
  });
});

// api/src/v1/maps/maps-embed.html.spec.ts
//
// #843 純粋関数（env 非依存）としての URL 組み立て・HTML エスケープの検証。
// 「q にスクリプトを混ぜても本文へそのまま出ない」「キーは iframe src にしか現れない」を固定する。

import {
  buildMapsEmbedSrc,
  escapeHtml,
  renderMapsEmbedPage,
} from './maps-embed.html';

describe('escapeHtml', () => {
  it('HTML の特殊文字をすべてエンティティへ変換する', () => {
    expect(escapeHtml(`"><script>alert(1)</script>`)).toBe(
      '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('& を含む文字列を二重変換しない（1 回だけ &amp; にする）', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });
});

describe('buildMapsEmbedSrc', () => {
  it('search モード: mode/q/key を含む Maps Embed API の URL を組み立てる', () => {
    const src = buildMapsEmbedSrc({
      mode: 'search',
      q: 'ラーメン 渋谷',
      apiKey: 'test-key',
    });
    const url = new URL(src);
    expect(url.origin + url.pathname).toBe(
      'https://www.google.com/maps/embed/v1/search',
    );
    expect(url.searchParams.get('key')).toBe('test-key');
    expect(url.searchParams.get('q')).toBe('ラーメン 渋谷');
  });

  it('place モード: q に place_id:<id> をそのまま渡す', () => {
    const src = buildMapsEmbedSrc({
      mode: 'place',
      q: 'place_id:ChIJplace1',
      apiKey: 'test-key',
    });
    const url = new URL(src);
    expect(url.pathname).toBe('/maps/embed/v1/place');
    expect(url.searchParams.get('q')).toBe('place_id:ChIJplace1');
  });

  it('center / zoom / hl は指定したときだけ含める', () => {
    const withoutOptional = new URL(
      buildMapsEmbedSrc({ mode: 'search', q: 'ramen', apiKey: 'k' }),
    );
    expect(withoutOptional.searchParams.has('center')).toBe(false);
    expect(withoutOptional.searchParams.has('zoom')).toBe(false);
    expect(withoutOptional.searchParams.has('hl')).toBe(false);

    const withOptional = new URL(
      buildMapsEmbedSrc({
        mode: 'search',
        q: 'ramen',
        center: '35.6,139.7',
        zoom: 15,
        hl: 'ja',
        apiKey: 'k',
      }),
    );
    expect(withOptional.searchParams.get('center')).toBe('35.6,139.7');
    expect(withOptional.searchParams.get('zoom')).toBe('15');
    expect(withOptional.searchParams.get('hl')).toBe('ja');
  });
});

describe('renderMapsEmbedPage', () => {
  it('iframe の src 属性へ埋め込む。key は本文全体でちょうど 1 回しか現れない', () => {
    const src = buildMapsEmbedSrc({
      mode: 'search',
      q: 'ramen',
      apiKey: 'super-secret-key',
    });
    const html = renderMapsEmbedPage(src);

    expect(html).toContain('<iframe');
    const occurrences = html.split('super-secret-key').length - 1;
    expect(occurrences).toBe(1);
    // iframe の src 属性の中にあること（テキストノードやコメントに漏れていないこと）
    expect(html).toMatch(/<iframe src="[^"]*super-secret-key[^"]*"/);
  });

  it('q に混ぜたスクリプトタグは本文へそのまま出ない（エスケープされる）', () => {
    const src = buildMapsEmbedSrc({
      mode: 'search',
      q: `"><script>alert(1)</script>`,
      apiKey: 'k',
    });
    const html = renderMapsEmbedPage(src);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toMatch(/[^&]<script>/);
  });
});

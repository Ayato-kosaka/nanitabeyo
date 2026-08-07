// api/src/share/share-page.html.spec.ts
//
// #721 共有カードの HTML が、JS 無しで OGP を持ち、外部由来の文字列で壊れないことを固定する。

import { escapeHtml, renderSharePage, type SharePageParams } from './share-page.html';

const BASE_PARAMS: SharePageParams = {
  title: '唐揚げ定食 - からあげ食堂',
  description: 'からあげ食堂 の 唐揚げ定食。なに食べよ で写真とレビューを見る。',
  imageUrl: 'https://app.nanitabeyo.net/s/s1_abc/og-image',
  canonicalUrl: 'https://app.nanitabeyo.net/s/s1_abc',
  ogLocale: 'ja_JP',
  openInAppUrl: 'https://oia-relay.web.app/oia/open/?u=https%3A%2F%2Fapp.nanitabeyo.net%2Fja-JP%2Fposts',
  openInWebUrl: 'https://app.nanitabeyo.net/ja-JP/posts?ids=a',
  labels: { openInApp: 'アプリで開く', openInWeb: 'ブラウザで見る' },
};

describe('#721 共有カードの HTML', () => {
  it('JS を実行しなくても OGP と X Card が読める', () => {
    const html = renderSharePage(BASE_PARAMS);

    // ここが本題。クローラは初回レスポンスの HTML しか見ない
    expect(html).toContain('<meta property="og:title" content="唐揚げ定食 - からあげ食堂">');
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain(`<meta property="og:url" content="${BASE_PARAMS.canonicalUrl}">`);
    expect(html).toContain(`<meta property="og:image" content="${BASE_PARAMS.imageUrl}">`);
    expect(html).toContain('<meta property="og:locale" content="ja_JP">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    // <script> を 1 つも含まない＝ JS 無効でも同じ内容が出る
    expect(html).not.toContain('<script');
  });

  it('og:url は /s/:token 自身（本体ページへ向けない）', () => {
    // 本体ページを og:url にすると、SNS のカードが本体 URL に紐づいてしまい、
    // 共有リンクごとに違う OGP を出す設計が成立しなくなる
    const html = renderSharePage(BASE_PARAMS);

    expect(html).toContain('content="https://app.nanitabeyo.net/s/s1_abc">');
  });

  it('この URL 自体は検索結果へ出さない（noindex, follow）', () => {
    // 1 投稿に対して共有リンクは何本でも作られる。index させると同じ内容の URL が量産される
    const html = renderSharePage(BASE_PARAMS);

    expect(html).toContain('<meta name="robots" content="noindex,follow">');
  });

  it('アプリ導線と Web 導線の両方を <a> で置く（JS に依存しない）', () => {
    const html = renderSharePage(BASE_PARAMS);

    expect(html).toContain(`href="${BASE_PARAMS.openInWebUrl}"`);
    expect(html).toContain('アプリで開く');
    expect(html).toContain('ブラウザで見る');
  });

  // ─ ここから注入の検知 ─
  // preview_title / description は店名・料理名（＝外部由来）を含む。
  // 属性値を抜けられると、共有カードの見た目ごと差し替えられる
  describe('外部由来の文字列で属性を抜けない', () => {
    it('タイトルの二重引用符と山括弧をエスケープする', () => {
      const html = renderSharePage({
        ...BASE_PARAMS,
        title: '"><script>alert(1)</script><meta x="',
      });

      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&quot;&gt;&lt;script&gt;');
      // meta タグの数が増えていない＝属性を抜けていない
      expect(html.match(/<meta property="og:title"/g)).toHaveLength(1);
    });

    it('description も同様にエスケープする', () => {
      const html = renderSharePage({ ...BASE_PARAMS, description: '"><img src=x onerror=alert(1)>' });

      expect(html).not.toContain('<img src=x');
    });

    it('画像 URL も属性値としてエスケープする', () => {
      const html = renderSharePage({ ...BASE_PARAMS, imageUrl: 'https://x/"><script>' });

      expect(html).not.toContain('"><script>');
    });
  });

  describe('escapeHtml', () => {
    it.each([
      ['&', '&amp;'],
      ['<', '&lt;'],
      ['>', '&gt;'],
      ['"', '&quot;'],
      ["'", '&#39;'],
    ])('%s を落とす', (input, expected) => {
      expect(escapeHtml(input)).toBe(expected);
    });

    it('& を先に変換する（二重エスケープにならない）', () => {
      // 順序を間違えると `&lt;` が `&amp;lt;` になり、画面に生タグの文字列が出る
      expect(escapeHtml('<a & b>')).toBe('&lt;a &amp; b&gt;');
    });
  });
});

// api/src/share/share-page.html.ts
//
// #721 【設計】`/s/:token` が返す HTML。
//
// ## 人間とクローラで出し分けない
// User-Agent を見てクローラにだけ別 HTML を返す Dynamic Rendering は採らない
//（Google は 2019 年以降これを回避策扱いにしており、cloaking と区別しづらい）。
// 同じ `200 OK` の HTML を全員へ返し、JS を実行しなくても OGP が読める状態にする。
//
// ## 人間だけは対象ページへ自動遷移させる（#1194）
// 遷移先（posts / 投票画面）には既に `OpenInAppBanner` があるので、この画面で
// 「アプリで開く」をもう一度出すのは重複でしかない。body 末尾の script で
// `location.replace` する。**HTML は全員に対して同一**で、クローラは JS を
// 実行しないため OGP はこれまでどおり読める。出し分けではない。
//
// ## テンプレートエンジンを入れない
// 返す HTML はこの 1 種類だけで、値はすべて属性値かテキストノード。
// エンジンを足すと「どこがエスケープ済みか」の境界が増えるので、
// 差し込みを `escapeHtml` の 1 関数へ閉じたベタ書きにする。

/**
 * HTML の特殊文字をエスケープする。
 *
 * ⚠️ **属性値もこれで通すこと。** `preview_title` は店名・料理名（＝外部由来の文字列）を
 * 含むため、`"` を落とさないと `content="..."` を抜けて属性を注入できる。
 * `'` も落とすのは、将来テンプレートを単引用符へ変えたときに壊れないようにするため。
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * script ブロックへ埋め込む JS 文字列リテラルを作る。
 *
 * ⚠️ **`escapeHtml` を使わないこと。** script の中身は HTML パーサから見て raw text なので
 * `&quot;` 等の実体参照は復号されず、そのまま JS の文字列に混ざる。
 * 逆に `</script` が現れると HTML パーサ側が script を閉じてしまうため、
 * **`<` を `\u003C` へ落とす**必要がある。
 *
 * 今の `openInWebUrl` は allowlist されたパス + `encodeURIComponent` なので `<` は入らないが、
 * 埋め込み先が script である以上、その前提に依存しない形にしておく。
 */
function jsStringLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003C');
}

export type SharePageParams = {
  /** 共有カードのタイトル（snapshot 済み） */
  title: string;
  description: string;
  /** og:image に入れる絶対 URL */
  imageUrl: string;
  /** og:url。`/s/:token` 自身 */
  canonicalUrl: string;
  /** `ja_JP` 形式 */
  ogLocale: string;
  /** 「アプリで開く」導線の URL（OIA relay 経由） */
  openInAppUrl: string;
  /** 「Web で見る」導線の URL（アプリ内の対象画面） */
  openInWebUrl: string;
  /** 導線のラベル（ロケール依存） */
  labels: { openInApp: string; openInWeb: string };
};

/**
 * 共有カード用の HTML を組み立てる。
 *
 * `robots` を `noindex,follow` にしているのは、この URL 自体を検索結果へ出したくないため。
 * 共有リンクは 1 つの投稿に対していくつも作られるので、インデックスさせると
 * 同じ内容の URL が量産される。`follow` は残して、リンク先（本体ページ）は辿らせる。
 */
export function renderSharePage(params: SharePageParams): string {
  const title = escapeHtml(params.title);
  const description = escapeHtml(params.description);
  const imageUrl = escapeHtml(params.imageUrl);
  const canonicalUrl = escapeHtml(params.canonicalUrl);
  const ogLocale = escapeHtml(params.ogLocale);
  const openInAppUrl = escapeHtml(params.openInAppUrl);
  const openInWebUrl = escapeHtml(params.openInWebUrl);
  const openInAppLabel = escapeHtml(params.labels.openInApp);
  const openInWebLabel = escapeHtml(params.labels.openInWeb);

  return `<!doctype html>
<html lang="${escapeHtml(params.ogLocale.replace('_', '-'))}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonicalUrl}">
<meta name="robots" content="noindex,follow">

<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${imageUrl}">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:locale" content="${ogLocale}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${imageUrl}">

<style>
:root{color-scheme:light dark}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f8f9fa;color:#111}
main{max-width:480px;width:100%;padding:24px;box-sizing:border-box;text-align:center}
img{width:100%;height:auto;border-radius:16px;display:block;margin:0 0 16px}
h1{font-size:20px;line-height:1.4;margin:0 0 8px}
p{font-size:14px;line-height:1.6;margin:0 0 24px;color:#555}
a{display:block;padding:14px 16px;border-radius:12px;text-decoration:none;font-weight:600}
a.primary{background:#111;color:#fff;margin-bottom:12px}
a.secondary{background:transparent;color:#111;border:1px solid #ccc}
@media (prefers-color-scheme:dark){body{background:#111;color:#f5f5f5}p{color:#aaa}a.primary{background:#f5f5f5;color:#111}a.secondary{color:#f5f5f5;border-color:#444}}
</style>
</head>
<body>
<main>
<img src="${imageUrl}" alt="${title}">
<h1>${title}</h1>
<p>${description}</p>
<a class="primary" href="${openInAppUrl}">${openInAppLabel}</a>
<a class="secondary" href="${openInWebUrl}">${openInWebLabel}</a>
</main>
<script>
/* #1194 【設計】人間はそのまま対象ページへ送る（中間画面で 1 タップ挟ませない）。
 *
 * 遷移先（posts / 投票画面）には既に OpenInAppBanner があり、「アプリで開く」導線は
 * そちらが持っている。ここで同じ導線をもう一度出すのは純粋な重複で、
 * 実機フィードバックで「中間画面は不要では」と指摘された。
 *
 * ⚠️ **これは crawler と人間の出し分け（cloaking）ではない。**
 * 返す HTML は全員に対して 1 バイトも変わらない。OGP は head にあり、
 * SNS のクローラは JS を実行しないので、この script は human のブラウザでしか動かない。
 * User-Agent を見て別の HTML を返す Dynamic Rendering とは別物。
 *
 * ⚠️ location.href ではなく **replace** を使うこと。href だと履歴に中間画面が残り、
 * 遷移先から «戻る» を押した瞬間にこの script がまた走って前へ弾き返される。
 *
 * 上の main 要素は JS が無い環境（クローラのプレビュー、JS 無効ブラウザ）の
 * フォールバックとしてそのまま残す。
 */
(function () {
  try {
    window.location.replace(${jsStringLiteral(params.openInWebUrl)});
  } catch (e) {
    /* 失敗しても上のリンクが残っているので、ここで握りつぶしてよい */
  }
})();
</script>
</body>
</html>
`;
}

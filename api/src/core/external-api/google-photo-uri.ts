/**
 * #819 【設計】**Google の写真 URL を «表示するサイズ» で渡す。**
 *
 * ## 何が起きていたか（本番実測）
 *
 * 一括取り込み（`bulkImportFromGoogle`）の同期レスポンスは、GCS の実体がまだ無いあいだ
 * **Google の `photoUri` をそのまま**アプリへ返している（#829）。その URL はこの形をしている。
 *
 *     https://lh3.googleusercontent.com/grass-cs/<token>=s4800-w3024
 *
 * `w3024` はこちらが `maxWidthPx` に **原寸**を渡している結果である（本番 90 日の要求幅の
 * 中央値 3,024px）。ところが表示枠は `imageUrls.sm` が 64px / `md` が 256px で
 * （`restaurants.assembler.ts` が GCS 側で焼いているサイズと同じ）、**一度も使われない**。
 *
 * 同じ写真を suffix だけ変えて取り直した実測（2026-09-26・2 枚）:
 *
 * | suffix | 写真 A | 写真 B |
 * | --- | ---: | ---: |
 * | `=s4800-w3024`（現状） | 2,116,824 B | **9,492,691 B** |
 * | `=w1280` | 373,385 B | 2,534,675 B |
 * | `=w1024` | 264,299 B | 1,688,165 B |
 * | **`=w1024-rj`** | — | **206,195 B（−97.8%）** |
 *
 * どれも HTTP 200 で、`=w1024` の実体は `1024 x 1280` の正しい画像だった。
 * **9.5 MB は PNG だったため**で、`-rj`（JPEG）を付けると桁が変わる。
 *
 * ## なぜ «Places へ小さく頼む» ではなくこちらなのか
 *
 * [PR #2034](https://github.com/Ayato-kosaka/nanitabeyo/pull/2034) は `maxWidthPx` を絞る形で
 * 出して [PR #2050](https://github.com/Ayato-kosaka/nanitabeyo/pull/2050) でリバートされた。
 * リバートの理由は 3 つで、**この方式はその全部を回避する**。
 *
 * | リバートの指摘 | この方式では |
 * | --- | --- |
 * | #429 の «原寸と一致しなければならない» 400 を踏むかもしれない | **Places のリクエストを 1 文字も変えない**ので無関係 |
 * | 原寸フォールバックを入れると**リクエスト単位の課金が 2 倍**になる | **Places を呼ばない**（CDN から別レンディションを取るだけ） |
 * | `maxHeightPx` が実際には送られていない（名前と挙動のずれ） | 幅だけを指定する形なので、ずれが生じない |
 *
 * ⚠️ **この suffix は Places のリファレンスに書かれた機能ではない。** ただし
 * `=s4800-w3024` という表記は **Places 自身が返してきたもの**で、`w` の値はこちらが
 * `maxWidthPx` で渡した数字がそのまま入っている。つまり «同じ表現の数字を変える» だけである。
 *
 * ⚠️ **GCS の実体が焼き上がったあとは、この URL は使われない。** 影響範囲は
 * «取り込み直後にアプリが見る 1 枚» に限られる（それが #819 の報告そのものである）。
 */

/** この書き換えを適用する host。Google のユーザーコンテンツ CDN だけを対象にする */
const GOOGLE_USERCONTENT_HOST_RE = /(^|\.)googleusercontent\.com$/i;

/**
 * Google の photoUri を、指定した幅の JPEG レンディションを指す URL へ書き換える。
 *
 * - `lh3.googleusercontent.com` 等でなければ **何もしない**（自前 CDN の署名付き URL を壊さない）
 * - 既に `=…` のサイズ指定があれば置き換える。無ければ足す
 * - クエリ文字列やフラグメントは保つ（いまの Places は付けてこないが、壊さない）
 *
 * @param uri Places が返した photoUri
 * @param width 表示に使う幅（px）
 */
export const withGooglePhotoWidth = (uri: string, width: number): string => {
  if (!Number.isInteger(width) || width <= 0) return uri;

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    // URL として読めないものは触らない（呼び出し側で null/空が混ざっても落ちないように）
    return uri;
  }
  if (!GOOGLE_USERCONTENT_HOST_RE.test(parsed.hostname)) return uri;

  // サイズ指定は **path の最後のセグメント**に `=` で付く（`/grass-cs/<token>=s4800-w3024`）
  const segments = parsed.pathname.split('/');
  const last = segments[segments.length - 1];
  if (!last) return uri;
  const equalsAt = last.indexOf('=');
  segments[segments.length - 1] =
    (equalsAt >= 0 ? last.slice(0, equalsAt) : last) + `=w${width}-rj`;
  parsed.pathname = segments.join('/');
  return parsed.toString();
};

/**
 * 🙈 spec 単位で許容する console error の共有定義。
 *
 * `fixtures/test.ts` の `allowedConsoleErrors`（部分一致・spec 単位）へ渡して使う。
 * **`KNOWN_CONSOLE_NOISE`（全 spec に効く）へ移さないこと。** 理由は各定数のコメントにある。
 */

/**
 * prerender されていない動的ルートへ **直接着地** したときに必ず出る hydration 不一致。
 *
 * ## なぜ構造上避けられないのか
 *
 * Firebase Hosting は最後の rewrite `** → /index.html` で、prerender されていない URL を
 * すべて `index.html`（ルート `app/index.tsx` の静的出力）で返す（firebase.json）。
 * その HTML はロケール解決前の «器» で本文テキストを持たないのに、ブラウザは URL に従って
 * 本来の画面を描くため、サーバ HTML とクライアントの木が食い違い、React が #418 を出して
 * クライアント側で描き直す。**画面は正しく出る**（各 spec のアサーションが実際に通っている）。
 *
 * 詳しい実測と «根本から消すと何を失うか» は
 * `tests/smoke/deep-link.spec.ts` の describe 直前のコメントにまとめてある。そこが正本。
 *
 * ## ⚠️ 全 spec の既知ノイズにしてはいけない
 *
 * #418 は #1503 が «公開ルートの prerender 不一致» を捕まえるために使っている検知点である。
 * 全 spec で無視すると、prerender されるべきルートが壊れても誰も気付けなくなる。
 * **«この spec が prerender されない動的ルートへ直接着地する» と言える場合にだけ**使うこと。
 *
 * 本番ビルドは minify 済みの `#418`、dev ビルドは `Hydration failed` の文言で出るので両方を並べる。
 */
export const PRERENDER_MISS_HYDRATION_NOISE = ["Minified React error #418", "Hydration failed"];

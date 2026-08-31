/**
 * `CORS_ORIGIN` 環境変数（カンマ区切り）を、`cors` パッケージが理解できる
 * 「文字列 or 正規表現」の配列へ変換する。
 *
 * ## なぜ変換が要るのか
 * NestJS の `enableCors({ origin })` は内部で `cors` パッケージを使う。その
 * `isOriginAllowed` は配列要素が **文字列なら `===` の完全一致**、
 * **RegExp なら `.test()`** でしか判定しない。つまり
 * `https://example--preview-*.web.app` と書いても `*` はワイルドカードとして
 * 展開されず「アスタリスクという文字を含むホスト名」として比較されるため、
 * Firebase Hosting の preview チャンネル（URL に毎回異なる hash が入る）は
 * 永久に一致しない。preflight が落ち、web の API 呼び出しが全滅する。
 *
 * ## 展開のルール
 * `*` は **1 ラベル内の DNS 文字（英数字とハイフン）** にのみ展開する。
 * `.*` にしてはいけない。`https://example--preview-*.web.app` を `.*` で
 * 組むと `https://example--preview-x.web.app.evil.com` のような
 * 「サフィックスを付け足しただけの別ドメイン」まで許可してしまう。
 *
 * ## 注意
 * 単独の `*`（全許可のつもりの値）は許可されない。展開結果が
 * `/^[A-Za-z0-9-]*$/` となり、実在するどの Origin にも一致しない。
 * これは変換前から同じ挙動（配列要素としての `'*'` は `cors` に全許可とは
 * 解釈されない）であり、`credentials: true` と全許可は併用できないため、
 * 許可したい Origin は必ず明示的に列挙すること。
 */

/** 正規表現のメタ文字を literal として扱えるようエスケープする。 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * カンマ区切りの Origin 定義を、`cors` に渡せる形へパースする。
 *
 * @param raw 例: `"http://localhost:8081,https://example--preview-*.web.app"`
 * @returns `*` を含まない項目は文字列のまま、含む項目は RegExp に変換した配列
 */
export function parseCorsOrigins(raw: string): (string | RegExp)[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((origin) =>
      origin.includes('*')
        ? new RegExp(
            `^${origin.split('*').map(escapeRegExp).join('[A-Za-z0-9-]*')}$`,
          )
        : origin,
    );
}

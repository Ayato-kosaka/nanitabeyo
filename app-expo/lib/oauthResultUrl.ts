/*
このファイルの責務
- OAuth のリダイレクト結果を運んでいる URL を「中身」で判定・選択する純粋関数を提供する。
- expo / supabase / react-native に依存しないため、単体テストで全分岐を検証できる。

なぜ「中身」で選ぶのか（#1062）
- 従来は `Linking.getInitialURL() || <router params から組み立てた URL>` と、
  出所の優先順位で決めていた。
- ところが Android の development build を QR / `expo start` の `a` キーで起動すると、
  dev launcher の起動 intent（`nanitabeyo://expo-development-client/?url=...`）が
  MainActivity に残り続け、`getInitialURL()` はそのセッション中ずっとその URL を返す。
  `onNewIntent` では `getIntent()` が更新されないため、OAuth の戻りが届いても変わらない。
- 結果、`code` を持つ router params 側が捨てられ、`exchangeCodeForSession` が呼ばれないまま
  「成功」として扱われていた（実機で QR 起動＝失敗 / アイコン起動＝成功 を確認済み）。
- そこで「どこから来たか」ではなく「認証結果を実際に持っているか」で選ぶ。
  これにより起動経路・プラットフォーム・ビルド種別に依存しなくなる。
*/

/** 認証結果 URL の出所。ログの `source` としてそのまま記録する。 */
export type OAuthUrlSource = "router_params" | "initial_url";

export type OAuthUrlCandidate = {
	source: OAuthUrlSource;
	url: string | null;
};

/** URL のクエリ部とフラグメント部を取り出す。 */
const splitUrl = (url: string): { query: URLSearchParams; fragment: URLSearchParams } => {
	const [beforeHash, fragment = ""] = url.split("#");
	const search = beforeHash.split("?").slice(1).join("?");
	return { query: new URLSearchParams(search), fragment: new URLSearchParams(fragment) };
};

/**
 * この URL が OAuth の結果（PKCE の code / エラー応答 / インプリシットの access_token）を
 * 運んでいるかを、中身だけで判定する。
 *
 * ⚠️ `??` チェーンで書かないこと。`?code=`（値が空）のとき `get("code")` は "" を返すため、
 * チェーンがそこで止まって後続の判定に到達せず、偽陰性になる。必ず `has()` と `||` で書く。
 */
export const carriesOAuthResult = (url: string | null | undefined): url is string => {
	if (!url) return false;
	const { query, fragment } = splitUrl(url);
	return query.has("code") || query.has("error") || query.has("error_code") || fragment.has("access_token");
};

/**
 * 候補のうち、認証結果を実際に持っている最初のものを返す。
 * どれも持っていなければ null を返し、呼び出し側に「失敗」として扱わせる（黙って進ませない）。
 */
export const pickOAuthResultUrl = (candidates: OAuthUrlCandidate[]): OAuthUrlCandidate | null =>
	candidates.find((candidate) => carriesOAuthResult(candidate.url)) ?? null;

/** `describeOAuthUrl` の戻り値。値ではなく「形」だけを持つ。 */
export type OAuthUrlShape = {
	scheme: string | null;
	query_keys: string[];
	fragment_keys: string[];
	error: string | null;
	error_code: string | null;
};

/**
 * ログ出力用に URL の «形» だけを取り出す。
 *
 * ⚠️ `code` / `access_token` / `refresh_token` の «値» は絶対に含めないこと。
 * これらはログ基盤（Cloud Logging → BigQuery）へ流れるため、生の URL を記録してはいけない。
 * 含めてよいのは、キー名と、非機密な `error` / `error_code` だけ。
 */
export const describeOAuthUrl = (url: string | null | undefined): OAuthUrlShape | null => {
	if (!url) return null;
	const { query, fragment } = splitUrl(url);
	const scheme = url.includes(":") ? url.split(":")[0] : null;
	return {
		scheme,
		query_keys: [...query.keys()].sort(),
		fragment_keys: [...fragment.keys()].sort(),
		error: query.get("error") ?? null,
		error_code: query.get("error_code") ?? null,
	};
};

/**
 * 認証結果 URL の «クエリ» を、デコード 1 回で読む（#1374 / PR #1393 のレビュー 2）。
 *
 * ## なぜ `Linking.parse` を使わないのか
 * `expo-linking` の `parse` は `new URL(...).searchParams`（1 回デコード）の結果へ、さらに
 * `decodeURIComponent` を掛ける（build/createURL.js:129-132）。**合計 2 回**である。
 * 一方 expo-router 側（OS のディープリンク着地＝経路 B）は `searchParams` の **1 回だけ**
 *（build/fork/getStateFromPath-forks.js）。経路によって回数が違う。
 *
 * #1374 以前は redirectTo を二重エンコードしていたので、経路 A ではその 2 回と釣り合って
 * «たまたま» 元に戻っていた。エンコードを 1 回に直した以上、読む側も 1 回に揃える必要がある。
 * 揃えないと経路 A が過剰にデコードし、次の 2 つが起きる。
 *
 *   1. `next` に `%XX` を含む行き先（例 `?q=%E3%83%A9…`）が別の文字列になる
 *   2. `next` に **裸の `%`** が含まれると `decodeURIComponent` が URIError を投げ、
 *      `Linking.parse` の `catch {}` がそれを飲む。`forEach` の途中で止まるため
 *      **`code` まで queryParams に入らず、ログイン自体が失敗する**
 *
 * ## ホスト部は触らない
 * ロケールは `Linking.parse(url).hostname` から取り続ける。Expo Go の `exp://host/--/path` を
 * `expo-linking` が正規化してくれるためで、`new URL` に置き換えると開発ビルドで
 * ホスト（IP）をロケールとして拾ってしまう。ここで直したいのはクエリのデコード回数だけである。
 *
 * @returns 読めなければ null（呼び出し側は従来どおりのフォールバックへ倒す）
 */
export const readOAuthResultQuery = (url: string | null | undefined): Record<string, string> | null => {
	if (!url) return null;
	try {
		const params: Record<string, string> = {};
		new URL(url).searchParams.forEach((value, key) => {
			params[key] = value;
		});
		return params;
	} catch {
		// スキームが URL として解釈できない等。呼び出し側のフォールバックに任せる
		return null;
	}
};

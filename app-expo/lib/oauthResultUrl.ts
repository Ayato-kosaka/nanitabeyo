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

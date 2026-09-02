/**
 * 🔗 共有リンク（`/s/:token`）の共有定義（#721）。
 *
 * API・app・テストがこの 1 ファイルだけを見るようにする。
 */

/**
 * 共有できる対象の種別。
 *
 * ⚠️ **値は「対象テーブル名」にすること。** このリポジトリの `target_type` は
 * `reactions` / `contribution_tasks` / `prompt_usages` の 3 テーブルで既に使われており、
 * 値はいずれも対象テーブル名（`dish_reviews` / `dish_media` / `dish_categories`）です。
 * UI 上の呼び名（「友達投票」）を識別子へ持ち込むと、どのテーブルを指すのかが
 * コードからも DB からも読めなくなります。
 *
 * この定数は `share_links.target_type` の CHECK 制約と **同じ集合**でなければなりません
 * （migration: `infra/supabase/migrations/*_create_share_links.sql`）。
 * 片方だけ増やすと、API は 201 を返すのに INSERT が落ちます。
 */
export const SHARE_LINK_TARGET_TYPES = ["dish_media", "dish_category_group_vote_sessions"] as const;

export type ShareLinkTargetType = (typeof SHARE_LINK_TARGET_TYPES)[number];

/** 共有リンクの状態。`revoked` は解決を止めるが、SNS 側のキャッシュまでは消せない */
export const SHARE_LINK_STATUSES = ["active", "revoked"] as const;

export type ShareLinkStatus = (typeof SHARE_LINK_STATUSES)[number];

/**
 * 1 リクエストで共有できる dish_media の上限。
 *
 * `/{locale}/posts?ids=` は元々カンマ区切りで複数 ID を受けるが、
 * 無制限だと 1 リンクの解決コストが読めなくなるため上限を置く。
 */
export const SHARE_LINK_MAX_DISH_MEDIA_IDS = 20;

/**
 * トークンの format バージョン接頭辞。
 *
 * 生成方式（長さ・エンコード・digest の取り方）を変えたくなったときに、
 * 既存リンクを壊さず並行運用するための目印。
 * `s1_` 以外の接頭辞が来たら、その世代の検証器へ振り分ける。
 */
export const SHARE_LINK_TOKEN_PREFIX = "s1_";

/**
 * トークンのランダム部のバイト数。
 *
 * 128bit あれば総当たりは成立しない。DB には生トークンではなく sha256 を保存するため、
 * DB が漏れてもリンクは復元できない。
 *
 * ⚠️ ここに server secret（HMAC）を足さないこと。共有リンクは SNS 上に長期間残るので、
 * secret をローテーションした瞬間に**過去のリンクが全部死ぬ**。
 * 鍵 ID を列に持って世代管理する覚悟がないなら、素の sha256 で十分。
 */
export const SHARE_LINK_TOKEN_RANDOM_BYTES = 16;

/** `/s/:token` のパス prefix。app / api / firebase.json で同じ値を使う */
export const SHARE_LINK_PATH_PREFIX = "s";

/**
 * 共有リンクのトークンとして形が正しいか（存在するかは見ない）。
 *
 * base64url なので `A-Za-z0-9_-`。長さは `SHARE_LINK_TOKEN_RANDOM_BYTES` から決まるが、
 * 世代が増えたときのために上下幅を持たせている。
 */
export function isShareLinkTokenShape(token: string): boolean {
	if (!token.startsWith(SHARE_LINK_TOKEN_PREFIX)) return false;
	const body = token.slice(SHARE_LINK_TOKEN_PREFIX.length);
	return /^[A-Za-z0-9_-]{16,64}$/.test(body);
}

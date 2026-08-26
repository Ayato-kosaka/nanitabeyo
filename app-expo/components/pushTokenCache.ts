/**
 * #1599 Push トークン登録が使う SecureStore キャッシュの読み取り。
 *
 * 【バグ】以前は `raw ? JSON.parse(raw) : null` と直に書いていた。
 * SecureStore の値が壊れていると **JSON.parse がそのまま throw する**。
 *
 * 投げた先の catch は「番人（registeredUserIdRef）を外して次の再描画で再試行する」
 * 作りなので、壊れた値がある限り
 *
 *   再描画 → parse で throw → error ログ → 番人を外す → 再描画 → …
 *
 * を繰り返す。しかも throw は `SecureStore.setItemAsync`（＝壊れた値を上書きする行）
 * **より前**で起きるので、**キャッシュは永遠に直らない**。
 * 結果、その端末では **Push 通知が二度と登録されない**まま、
 * `push_token_registration_error` が出続ける。
 *
 * 【設計】キャッシュは «速くするためだけのもの» であって、正しさの根拠ではない。
 * 読めない値は「キャッシュが無い」と同じに倒す。そうすれば `needsSync` が立ち、
 * 通常の登録経路が走って壊れた値を上書きする（＝自己修復する）。
 */
export type PushCache = {
	token: string;
	userId: string;
	platform: string;
	appVersion?: string | null;
};

/** 形が合っているか。JSON として読めても中身が別物なら使えない */
const isPushCache = (value: unknown): value is PushCache => {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return typeof v.token === "string" && typeof v.userId === "string" && typeof v.platform === "string";
};

/**
 * SecureStore から読んだ生文字列を `PushCache` にする。
 * **読めない・形が違うものはすべて `null`（= キャッシュ無し）** に倒す。決して throw しない。
 */
export function readPushCache(raw: string | null | undefined): PushCache | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isPushCache(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

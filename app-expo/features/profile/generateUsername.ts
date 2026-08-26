/**
 * #1599 サインアップ時に自動採番するユーザー名。
 *
 * 【バグ】以前は `user${Date.now() + Math.floor(Math.random() * 1000)}` だった。
 * ミリ秒のタイムスタンプに 0〜999 を足しているだけなので、**同じ 1 秒のあいだに
 * サインアップした 2 人は現実的な確率で同じ文字列になる**。
 * `users.username` には UNIQUE (`uq_users_username`) が張ってあるので、
 * ぶつかった側の INSERT は 23505 で落ちる。
 *
 * 【設計】タイムスタンプ（13 桁）と独立した 6 桁の乱数を **連結**する（足さない）。
 * 足すと桁が繰り上がって混ざり、乱数の意味が消える。連結なら
 * 「同じミリ秒」かつ「同じ 6 桁」でなければぶつからない。
 *
 * 形は従来どおり `user` + 数字のみに保つ（citext の大小無視とも衝突しない）。
 */
export const USERNAME_RANDOM_DIGITS = 6;

export function generateUsername(
	now: number = Date.now(),
	random: () => number = Math.random,
): string {
	const suffix = Math.floor(random() * 10 ** USERNAME_RANDOM_DIGITS)
		.toString()
		.padStart(USERNAME_RANDOM_DIGITS, "0");
	return `user${now}${suffix}`;
}

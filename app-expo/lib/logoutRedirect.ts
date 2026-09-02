/**
 * `SIGNED_OUT` 後に root route へ戻る理由を、ナビゲーションの URL に載せずに引き継ぐ。
 *
 * Android では `router.replace("/")` は動作する一方、query 付き文字列や object href は
 * フリーズした実測がある。URL を変えずにホームのロケールを維持するため、同一 JS runtime
 * 内で一度だけ消費するフラグにする。
 */
let pendingLogoutLocale: string | null = null;

export const requestLogoutRedirect = (locale: string) => {
	pendingLogoutLocale = locale;
};

export const consumeLogoutRedirect = (): string | null => {
	const locale = pendingLogoutLocale;
	pendingLogoutLocale = null;
	return locale;
};

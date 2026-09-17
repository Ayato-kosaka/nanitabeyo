import type { Locator } from "@playwright/test";

/**
 * 🚰 «静的 HTML が見えている» と «アプリが動き出した» を区別する（#1785）
 *
 * web は expo-router の静的エクスポート（`output: "static"`）なので、ルートの HTML は
 * **ビルド時に Node で描かれて** そのまま配信される。ブラウザは JS を待たずにそれを描くため、
 * `toBeVisible()` は **hydration の前に**満たされてしまう。
 *
 * この «見えているのに、まだ動いていない» 窓で状態を読むと、ビルド時の値を読む。
 * 実際に `/{locale}/add-record?url=…` で起きた（#1785）:
 *
 * | 経過 | 何が起きたか |
 * | --- | --- |
 * | 167ms | 静的 HTML の貼り付け欄が **見える**。`?url=` はビルド時に存在しないので **空** |
 * | 1028ms | ルート本体が hydrate され、共有された URL が入る |
 *
 * 間の 0.9 秒に `inputValue()` を読むと `""` が返る。**アプリの不具合ではなく、
 * 静的 HTML を読んでいる**。dev サーバでは静的 HTML が無いので再現せず、
 * 本番相当のエクスポートでだけ落ちていた。
 *
 * ## なぜ React fiber を見るのか
 *
 * react-dom は hydrate した DOM ノードへ `__reactFiber$…` を生やす。つまりこれは
 * **「この要素は React の管理下に入った」** という、その要素自身が持つ事実である。
 * 「バンドルが読み込まれた」「NavigationContainer が mount した」ではまだ足りない
 * （実測でルート本体の hydration はその 164ms 後だった）。
 *
 * ⚠️ **`waitForTimeout()` で代用しないこと。** CI の負荷で hydration の時刻は動く。
 * 待つべきは時間ではなく «その要素が hydrate されたこと» である。
 *
 * ⚠️ `appPage` 経由（トップを開いてからアプリ内遷移）ではこの窓は存在しない。
 * 必要になるのは **URL 直叩きで着地する画面**（共有シートからの着地など）だけである。
 */
export async function waitForHydrated(locator: Locator): Promise<void> {
	await locator.first().evaluate((element) => {
		if (Object.keys(element).some((key) => key.startsWith("__reactFiber$"))) return;
		return new Promise<void>((resolve) => {
			const timer = setInterval(() => {
				if (Object.keys(element).some((key) => key.startsWith("__reactFiber$"))) {
					clearInterval(timer);
					resolve();
				}
			}, 16);
		});
	});
}

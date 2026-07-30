import type { Page } from "@playwright/test";

/**
 * 🖼️ 先読み画像(PRELOAD_ASSETS)の観測ユーティリティ
 *
 * app-expo/constants/preloadAssets.ts の `PRELOAD_ASSETS` と必ず対応させること。
 * 先読みは検索画面の末尾に置かれたオフスクリーン View（components/PreloadImageDeck.tsx）で
 * `expo-image` の <Image> として描画される。web ビルドの expo-image は
 * <img src> を DOM へ出すため、Resource Timing と <img> の両方から観測できる。
 *
 * ## なぜ「時間」ではなく「状態」で観測するか(#1083 設計 §6)
 * 先読みが効いているかを「何 ms 以内に表示されたか」で測るとランナーの速度でフレークする。
 * ここで提供するのは ①エントリの存在 ②取得完了(responseEnd > 0) ③開く前に開始したか
 * (startTime < クリック時刻) という **順序と状態** を読むための道具だけで、
 * 絶対時間の閾値は一切持たない。
 */

/**
 * 先読み対象アセットの pathname パターン(`expo export --platform web` 出力に対応)。
 *
 * ハッシュ部分は再ビルドのたびに変わるため `[^/]+` で吸収する。
 * ⚠️ ディレクトリを含めて前方を固定し、末尾を `$` で閉じること。
 * `images/icon\.` を単に `icon` と書くと `logo_apple_icon` / `logo_google_g_icon` にも
 * 一致してしまい、1 枚欠けても他の 1 枚が肩代わりして **偽の緑**になる。
 *
 * RegExp ではなく文字列で持つのは、`page.evaluate` の引数として渡すため
 * (RegExp はシリアライズできない)。
 */
export const PRELOAD_ASSET_PATTERNS = {
	"search-page1": "/assets/assets/images/tutorial/search-page1\\.[^/]+\\.webp$",
	"search-page2": "/assets/assets/images/tutorial/search-page2\\.[^/]+\\.webp$",
	"search-page3": "/assets/assets/images/tutorial/search-page3\\.[^/]+\\.webp$",
	"search-page4": "/assets/assets/images/tutorial/search-page4\\.[^/]+\\.webp$",
	icon: "/assets/assets/images/icon\\.[^/]+\\.webp$",
	"review-hero": "/assets/features/review/assets/review-hero\\.[^/]+\\.webp$",
	logo_apple_icon: "/assets/assets/images/logo_apple_icon\\.[^/]+\\.png$",
	logo_google_g_icon: "/assets/assets/images/logo_google_g_icon\\.[^/]+\\.png$",
} as const;

/** 先読み対象アセットのキー */
export type PreloadAssetKey = keyof typeof PRELOAD_ASSET_PATTERNS;

/**
 * 期待される先読みアセットのキー一覧(ソート済み)。
 * `toHaveLength(8)` ではなくこの配列との一致を検証することで、
 * 失敗時に **どのアセットが欠けたか**が名指しでレポートに出る。
 */
export const PRELOAD_ASSET_KEYS: PreloadAssetKey[] = (Object.keys(PRELOAD_ASSET_PATTERNS) as PreloadAssetKey[]).sort();

/**
 * pathname が先読み対象のどれに当たるかを判定する(どれでもなければ null)。
 *
 * チュートリアルシート内の <img> が「先読みしたのと同じ URL か」を確かめるために使う。
 * 先読みとシートで URL が食い違う回帰(リサイズ付与など)はここで落ちる。
 *
 * @param pathname 判定対象の pathname(クエリ・オリジンを含まないこと)
 */
export function matchPreloadAssetKey(pathname: string): PreloadAssetKey | null {
	for (const key of PRELOAD_ASSET_KEYS) {
		if (new RegExp(PRELOAD_ASSET_PATTERNS[key]).test(pathname)) return key;
	}
	return null;
}

/**
 * **取得が完了した**先読みアセットのキー一覧を返す(ソート済み・重複なし)。
 *
 * `responseEnd > 0` は「取得が完了した」ことを表すフラグとして使っており、
 * 所要時間の閾値ではない(遅いランナーでも真になる)。
 *
 * @param page 対象ページ
 */
export async function collectCompletedPreloadAssetKeys(page: Page): Promise<string[]> {
	return page.evaluate((patterns: Record<string, string>) => {
		const found = new Set<string>();

		for (const entry of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
			if (!(entry.responseEnd > 0)) continue;

			const pathname = new URL(entry.name, window.location.href).pathname;
			for (const [key, source] of Object.entries(patterns)) {
				if (new RegExp(source).test(pathname)) found.add(key);
			}
		}

		return [...found].sort();
	}, PRELOAD_ASSET_PATTERNS);
}

/**
 * 指定 URL の Resource Timing エントリのうち、最も早い `startTime` を返す(無ければ null)。
 *
 * 「チュートリアルを開く前に取得が始まっていたか」を
 * `startTime < クリック時刻` という **同一タイムライン上の前後関係**で検証するために使う。
 *
 * @param page 対象ページ
 * @param url 絶対 URL(<img>.src プロパティの値をそのまま渡せる)
 */
export async function findResourceStartTime(page: Page, url: string): Promise<number | null> {
	return page.evaluate((target) => {
		const entries = performance.getEntriesByName(target, "resource");
		if (entries.length === 0) return null;
		return Math.min(...entries.map((entry) => entry.startTime));
	}, url);
}

import type { Page } from "@playwright/test";

/**
 * 🖼️ 先読み画像(PRELOAD_IMAGES)の観測ユーティリティ
 *
 * app-expo/features/search/constants.ts の `PRELOAD_IMAGES` と必ず対応させること。
 * 先読みは検索画面の末尾に置かれた 1x1 のオフスクリーン View（search/index.tsx）で
 * `expo-image` の <Image> として描画される。web ビルドの expo-image は
 * <img src> を DOM へ出すため、Resource Timing と <img> の両方から観測できる。
 *
 * #1486 で先読み対象はオンボーディングの 6 枚（共感 3 + 解決 3）へ入れ替わった。
 * オンボーディングは検索画面から push される別ルートなので、
 * 「検索画面に居るうちに 6 枚とも取り終えているか」がそのまま
 * 「ページ送りでロード待ちが出ないか」（#1486 §2 の受け入れ条件）の検査になる。
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
	"onboarding-step1-empathy": "/assets/assets/images/onboarding/step1-empathy\\.[^/]+\\.webp$",
	"onboarding-step1-solution": "/assets/assets/images/onboarding/step1-solution\\.[^/]+\\.webp$",
	"onboarding-step2-empathy": "/assets/assets/images/onboarding/step2-empathy\\.[^/]+\\.webp$",
	"onboarding-step2-solution": "/assets/assets/images/onboarding/step2-solution\\.[^/]+\\.webp$",
	"onboarding-step3-empathy": "/assets/assets/images/onboarding/step3-empathy\\.[^/]+\\.webp$",
	"onboarding-step3-solution": "/assets/assets/images/onboarding/step3-solution\\.[^/]+\\.webp$",
	icon: "/assets/assets/images/icon\\.[^/]+\\.webp$",
	// #1403 (PR1) `review-hero` はここから外した。レビュータブと一緒に
	// `features/review/assets/review-hero.webp` ごと削除され、`PRELOAD_IMAGES`
	// （app-expo/features/search/constants.ts）からも消えている。
	// 残しておくと «取得完了したアセット» の集合に永遠に現れず、
	// tests/search/tutorial-preload.spec.ts が **アプリのバグではない理由で赤くなる**
	logo_apple_icon: "/assets/assets/images/logo_apple_icon\\.[^/]+\\.png$",
	logo_google_g_icon: "/assets/assets/images/logo_google_g_icon\\.[^/]+\\.png$",
} as const;

/** 先読み対象アセットのキー */
export type PreloadAssetKey = keyof typeof PRELOAD_ASSET_PATTERNS;

/**
 * 期待される先読みアセットのキー一覧(ソート済み)。
 * `toHaveLength(10)` ではなくこの配列との一致を検証することで、
 * 失敗時に **どのアセットが欠けたか**が名指しでレポートに出る。
 */
export const PRELOAD_ASSET_KEYS: PreloadAssetKey[] = (Object.keys(PRELOAD_ASSET_PATTERNS) as PreloadAssetKey[]).sort();

/**
 * pathname が先読み対象のどれに当たるかを判定する(どれでもなければ null)。
 *
 * オンボーディング画面内の <img> が「先読みしたのと同じ URL か」を確かめるために使う。
 * 先読みと本番表示で URL が食い違う回帰(リサイズ付与など)はここで落ちる。
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

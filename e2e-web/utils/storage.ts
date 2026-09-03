import type { BrowserContext } from "@playwright/test";

/**
 * 💾 localStorage シード用ユーティリティ
 *
 * アプリは `@react-native-async-storage/async-storage` を使用しており、
 * Web ビルドでは localStorage がバックエンドになる。
 * テストの前提状態（チュートリアル済みなど）は addInitScript で事前にシードする。
 */

/**
 * オンボーディングの表示済みフラグのキー。
 * app-expo/features/onboarding/onboardingSeenStore.ts の `ONBOARDING_STORAGE_KEY` と一致させること。
 *
 * #1486 §3 でオンボーディングは刷新されたが、**キーは旧チュートリアルのまま**にしてある
 *（変えると既読の既存ユーザー全員へ再表示されるため）。名前に `TUTORIAL` が残るのはその名残。
 */
export const TUTORIAL_STORAGE_KEY = "search_tutorial_seen_v1";

/**
 * 料理提案画面スポットライトチュートリアルの表示済みフラグ。
 * app-expo/features/dishCategories/hooks/useDishCategoriesTutorial.ts と必ず一致させる。
 */
export const DISH_CATEGORIES_TUTORIAL_STORAGE_KEY = "topics_spotlight_tutorial_seen_v1";

/**
 * 「食べたい/食べた」画面スポットライトチュートリアルの表示済みフラグ。
 * app-expo/features/myDishes/components/MyDishesSpotlightTutorial.tsx の
 * `MY_DISHES_TUTORIAL_STORAGE_KEY` と必ず一致させる。
 *
 * ⚠️ #1629 これをシードしないと、**このタブに来た全てのテストがオーバーレイに遮られる**。
 * オーバーレイは画面全体を覆うので、症状は «その画面が壊れている» ではなく
 * «タブバーのボタンが押せない»（他の要素がクリックを横取りする）として出る。
 * 実際に `tests/navigation/tab-bar.spec.ts` がこれで 30 秒待って落ちていた。
 */
export const MY_DISHES_TUTORIAL_STORAGE_KEY = "my_dishes_spotlight_tutorial_seen_v1";

/**
 * オンボーディングを「表示済み」としてシードする。
 *
 * ja-JP ロケールでは検索タブ初回フォーカス時にオンボーディング画面へ自動遷移し、
 * 他のテストの操作を妨げるため、既定では全テストでこのシードを行う
 * （オンボーディング自体のテストのみ意図的にシードを外す）。
 *
 * @param context ブラウザコンテキスト（ページ生成前に呼ぶこと）
 */
export async function seedTutorialAsSeen(context: BrowserContext): Promise<void> {
	await context.addInitScript((key) => {
		window.localStorage.setItem(key, "true");
	}, TUTORIAL_STORAGE_KEY);
}

/**
 * 料理提案画面チュートリアルを「表示済み」としてシードする。
 *
 * 料理提案画面を操作する既存E2Eがスポットライトに遮られないよう、
 * 専用spec以外ではfixtureから既定で適用する。
 */
export async function seedDishCategoriesTutorialAsSeen(context: BrowserContext): Promise<void> {
	await context.addInitScript((key) => {
		window.localStorage.setItem(key, "true");
	}, DISH_CATEGORIES_TUTORIAL_STORAGE_KEY);
}

/**
 * 「食べたい/食べた」チュートリアルを「表示済み」としてシードする。
 *
 * このタブを通る（あるいはタブバーを操作する）テストがスポットライトに遮られないよう、
 * 専用 spec 以外では fixture から既定で適用する。
 */
export async function seedMyDishesTutorialAsSeen(context: BrowserContext): Promise<void> {
	await context.addInitScript((key) => {
		window.localStorage.setItem(key, "true");
	}, MY_DISHES_TUTORIAL_STORAGE_KEY);
}

/**
 * 「最近使った場所」の保存キー。
 * app-expo/features/search/hooks/useRecentLocations.ts の RECENT_LOCATIONS_STORAGE_KEY と一致させること。
 *
 * ⚠️ ホーム（さがすタブ）と保存料理カテゴリの地点検索モーダルは **同じキー** を共有する（#1133）。
 * ここを片方だけ変えると「ホームで選んだ地点がモーダルに出ない」不具合になる。
 */
export const RECENT_LOCATIONS_STORAGE_KEY = "recent_locations_v1";

/**
 * 「最近使った場所」1件分の最小形。
 *
 * 実体は app-expo の `RecentLocation`（= LocationDetailsResponse から viewport を除いたもの
 *  + locationQuery）だが、e2e-web からは @shared/app-expo の型を参照できないため、
 * 画面が実際に読む項目だけをここで定義する。
 * - `locationQuery`: パネルに表示される文字列
 * - `location`: 再選択時に details API を呼ばずに検索へ進むための緯度経度
 */
export type SeededRecentLocation = {
	locationQuery: string;
	location: { latitude: number; longitude: number };
	/**
	 * ⚠️ **推薦 API 用の «機械可読なトークン列»。表示用の住所ではない。**
	 * 例: `"country:JP, administrative_area_level_1:Tokyo, locality:Shibuya"`
	 * 詳細と判定の正は `app-expo/lib/addressFormat.ts`（`isCanonicalAddress`）。
	 */
	address?: string;
	localLanguageCode?: string;
};

/**
 * シードした address が、アプリに «読み捨てられない» 形式かどうか。
 *
 * ## なぜこの検査が要るのか（実際に踏んだ）
 * #1196 で `useRecentLocations` は読み出し時に `isCanonicalAddress` で検査し、
 * 正規形式でないエントリを **黙って捨てる**ようになった。
 * `address: "東京都テスト区1"` のような «表示用に見える» 文字列でシードすると、
 * 5 件積んだつもりでも 0 件になり、症状は
 * **「最近使った場所パネルが出てこない」というタイムアウトだけ**になる。
 * seed 側が原因だと気付けず、実際にマージ後の nightly を 1 回赤くした。
 *
 * ⚠️ 判定の正は `app-expo/lib/addressFormat.ts` にある。e2e-web からは app-expo の
 * モジュールを参照できない（tsconfig の paths は `@shared/*` だけ）ため、
 * ここでは **最小要件（`country:` + 大文字 2 文字）だけ**を写している。
 * アプリ側の条件が厳しくなったらここも追随すること。
 * 写しであっても «黙って 0 件» よりは桁違いにましなので置いている。
 */
const hasCanonicalAddress = (address: string | undefined): boolean =>
	!!address &&
	address
		.split(",")
		.map((token) => token.trim())
		.some((token) => /^country:[A-Z]{2}$/.test(token));

/**
 * 「最近使った場所」を事前シードする（#1133）。
 *
 * 実 API（autocomplete → details）を経由して 1 件積むこともできるが、
 * 「パネルが何件で、どんな文字列で描画されるか」を固定したいテストでは
 * 実 API の候補文言に依存させたくないため、localStorage を直接シードする。
 * 「ホームと本当に共有されているか」を見るテストだけは実 API 経由で積むこと
 * （シードだと共有そのものを検証したことにならない）。
 *
 * @param context ブラウザコンテキスト（ページ生成前に呼ぶこと）
 * @param locations 新しい順に並べた地点（先頭が最新。アプリ側の上限は5件）
 */
export async function seedRecentLocations(context: BrowserContext, locations: SeededRecentLocation[]): Promise<void> {
	// アプリが読み捨てる形式でシードしても «パネルが出ない» としか観測できないので、
	// ここで即座に、原因の分かる形で落とす
	const discarded = locations.filter((location) => !hasCanonicalAddress(location.address));
	if (discarded.length > 0) {
		throw new Error(
			`seedRecentLocations: address が正規形式でないエントリがあります（アプリ側が読み出し時に捨てるため、` +
				`パネルは 0 件になります）: ${discarded.map((l) => `${l.locationQuery}=${JSON.stringify(l.address)}`).join(", ")}\n` +
				`正規形式の例: "country:JP, administrative_area_level_1:Tokyo, locality:Shibuya"（app-expo/lib/addressFormat.ts）`,
		);
	}

	await context.addInitScript(
		([key, value]) => {
			window.localStorage.setItem(key as string, value as string);
		},
		[RECENT_LOCATIONS_STORAGE_KEY, JSON.stringify(locations)] as const,
	);
}

/**
 * 表示テーマ（システム追従 / ライト / ダーク）の保存キー。
 * app-expo/contexts/ThemeProvider.ts の `THEME_PREFERENCE_STORAGE_KEY` と一致させること（#1509）。
 */
export const THEME_PREFERENCE_STORAGE_KEY = "theme_preference_v1";

/** 設定画面の 3 択と同じ型（app-expo/contexts/ThemeProvider.tsx の ThemePreference） */
export type SeededThemePreference = "system" | "light" | "dark";

/**
 * 表示テーマの設定を事前シードする（#1509）。
 *
 * 「再起動しても保持される」を検証するときは **シードではなく実際に UI で切り替えてから
 * reload する**こと（シードだと保存経路を検証したことにならない）。
 * このシードは「ダーク状態で開いた画面を検査したい」ように、切替操作そのものが
 * 主題ではないテストのために使う。
 *
 * @param context ブラウザコンテキスト（ページ生成前に呼ぶこと）
 */
export async function seedThemePreference(context: BrowserContext, preference: SeededThemePreference): Promise<void> {
	await context.addInitScript(
		([key, value]) => {
			window.localStorage.setItem(key as string, value as string);
		},
		[THEME_PREFERENCE_STORAGE_KEY, preference] as const,
	);
}

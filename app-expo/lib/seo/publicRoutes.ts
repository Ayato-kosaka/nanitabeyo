// ⚠️ 相対 import にしてあるのは、このモジュールを **e2e-web（Playwright）からも import する**ため。
// `@/` エイリアスは app-expo の tsconfig のものなので、他パッケージから読むと解決先が増えてしまう。
import { LEGAL_SITEMAP_ROUTES } from "../legalRoute";

/**
 * 🔗 «URL を直に叩いて開ける» 公開ルートの唯一の一覧（#1503）。
 *
 * ## なぜ 1 箇所へ集めるのか
 * REL-01（#1503）では、公開 4 ルートの直リンクがすべて白画面になっていたのに、
 * e2e の直リンクスモークは `profile` と `search` を **手書きで 2 本**持っているだけだった。
 * 手で書いた一覧は、ルートが増えたときに誰も更新しない。そこで
 *
 * - スモークは **この配列を回して**テストを生成する（`e2e-web/tests/smoke/deep-link.spec.ts`）
 * - sitemap の `SITEMAP_ROUTES` もここから導出する（`lib/seo/sitemap.ts`）
 * - 追加漏れは `__tests__/publicRoutes.test.ts` が
 *   「`app/[locale]/(tabs)/` 配下の静的ルート」と突き合わせて落とす
 *
 * という形にした。**ルートを足したときに直すのはこのファイルだけ**にする。
 *
 * ## ⚠️ 依存を増やさないこと
 * `lib/legalRoute.ts` と同じく、react / react-native / supabase / Env を import しない。
 * このモジュールは Node のスクリプト（`scripts/generate-sitemap.mjs`）と Playwright
 * （`e2e-web`）の両方から読まれるため、アプリ側の依存が混ざると両方が壊れる。
 */

/**
 * sitemap に載せる（＝検索結果へ出したい）公開ルート。
 *
 * locale prefix より後ろのパス。除外の判断基準は `lib/seo/sitemap.ts` のコメントを参照。
 */
export const INDEXABLE_ROUTES: readonly string[] = [
	"search",
	// #1419 "map" は外した。マップタブは `href: null` で到達不能なまま sitemap にだけ出ていた
	"review",
	"review/selectRestaurant",
	...LEGAL_SITEMAP_ROUTES,
];

/**
 * sitemap には載せないが、**直リンクで開けなければならない**ルート。
 *
 * 検索結果の入口にはしない（ログイン後の個人ページなので中身が無い）が、
 * プッシュ通知・アプリ内共有・ブックマークから URL を直に踏まれる経路は現に存在する。
 * REL-01 で白画面になっていた 4 ルートのうち 2 本がここに当たる。
 */
export const NON_INDEXABLE_DEEP_LINK_ROUTES: readonly string[] = [
	"profile",
	"notifications",
	/*
	#1583 設定から割り出した 2 画面。ログイン不要で中身が出る（表示テーマは端末ローカル、
	なに食べよについては規約リンクと版数）ので、除外ではなくスモークの対象にしている。
	問い合わせ対応で «バージョンを教えてください» と URL を直に渡す使い方も想定している。
	*/
	"profile/device-settings",
	"profile/about",
];

/**
 * 直リンクスモーク（`e2e-web/tests/smoke/deep-link.spec.ts` /
 * `e2e-mobile/tests/smoke/deep-link.test.ts`）が回す公開ルートの全件。
 *
 * **ルートを足したらここに 1 行足す**。それ以外の追随（テストの本数・sitemap）は自動で付いてくる。
 */
export const DEEP_LINK_SMOKE_ROUTES: readonly string[] = [...INDEXABLE_ROUTES, ...NON_INDEXABLE_DEEP_LINK_ROUTES];

/**
 * 直リンクスモークから **意図的に外している** ルートと、その理由。
 *
 * `__tests__/publicRoutes.test.ts` は `app/[locale]/(tabs)/` 配下の静的ルートを走査し、
 * 「`DEEP_LINK_SMOKE_ROUTES` にも、この表にも無いルート」があればテストを落とす。
 * つまりルートを足した人は **必ずどちらかへ書く**ことになる（黙って抜けない）。
 *
 * キーは locale prefix より後ろのパス。
 */
export const DEEP_LINK_SMOKE_EXCLUSIONS: Readonly<Record<string, string>> = {
	// `?ids=` のクエリ前提。クエリ無しでは表示対象が決まらない（#721）
	posts: "クエリ（?ids=）が無いと表示対象が決まらないため、直リンクの対象にしない",

	// ログイン必須の個人ページ。未ログインの直リンクでは «ログインしてください» しか出ず、
	// 「画面が描画されたか」の判定材料にならない。ログイン後の導線は
	// tests/authenticated/ 配下の spec が担保している
	"profile/edit": "ログイン必須。未ログインでは中身が無い",
	"profile/settings": "ログイン必須。未ログインでは中身が無い",
	"profile/feedback": "ログイン必須。未ログインでは中身が無い",
	"profile/blocked-topics": "ログイン必須。未ログインでは中身が無い",
	"profile/food": "ログイン必須。未ログインでは中身が無い",
	"profile/saved-topic-location": "ログイン必須。未ログインでは中身が無い",
	"profile/search-results": "ログイン必須。未ログインでは中身が無い",

	// 通知一覧のサブタブ。親（notifications）を踏めば同じレイアウトを通る
	"notifications/feed": "notifications の子タブ。親ルートで同じレイアウトを検証済み",

	// 検索フローの途中の画面。直リンクでは «前の画面で選んだ条件» が無い状態になる。
	// フローとしての検証は tests/search/ の spec が持っている
	"search/topics": "検索フローの途中の画面。前画面の条件（場所・時間帯・シーン）が無い状態を直リンクの正とはしない",
	"search/result": "検索フローの途中の画面。検索条件のパラメータ前提のため直リンクの対象にしない",
};

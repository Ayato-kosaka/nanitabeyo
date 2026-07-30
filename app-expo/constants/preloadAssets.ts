// #1087 【設計】先読み対象アセットの単一の定義元
//
// ## なぜ source と cachePolicy を 1 レコードにするか
// #785 に「同一 URL を異なる cachePolicy で読み込むと iOS の画像パイプラインが分かれて
// イベントが欠落し得る」という判断が記録されている。つまり **先読み側と全表示側で
// cachePolicy が完全に一致していること**が要件で、片側だけ書き換える事故が起きてはいけない。
// 実際 icon.webp は memory-disk × 3 箇所 / disk × 1 箇所(ProfileHeader)に割れていた。
//
// そこで source と cachePolicy をここで 1 対 1 に束ね、表示側は `components/PreloadedImage.tsx`
// 経由でしか描かない形にする。`source` を書けば必ずポリシーが付いてくるので、
// 片側だけ変えることが構造的にできなくなる。
//
// ## ポリシーの選び方(#1087 設計 §1-2, §3)
// これらはすべて `require()` のアプリ埋め込みローカルアセットなので、
// **disk 成分には意味が無い**(既に端末内にあるバイト列を SDImageCache/Glide のキャッシュ
// ディレクトリへ複製するだけ)。むしろ既定の `disk` は
// - iOS: `queryCacheType = .disk` になりメモリキャッシュを参照しない
// - Android: `skipMemoryCache(true)` が付く
// ため、**先読みで decode した結果が保持されない**。これが #1087 の症状の直接の原因。
//
// ただし decode 後のビットマップは原寸 × 4byte で、ファイルサイズの 150 倍以上になる。
// 8 枚すべてを memory 常駐させると 44.48 MiB に達するため、アセット単位で選ぶ:
//
// | アセット | 実寸法 | decode 後 | ポリシー | 理由 |
// |---|---|---|---|---|
// | tutorialPage1..4 | 1920×1080 | 各 7.91 MiB | `disk`(据え置き) | 4 枚で 31.6 MiB と大きすぎる。既読フラグで初回しか出ないので投資に見合わない。本質的な手当てはアセットのリサイズ(別 Issue) |
// | reviewHero | 1512×1512 | 8.72 MiB | `memory` | ユーザー症状が出ている当該アセット。増分はこの 1 枚のみ |
// | appIcon | 746×746 | 2.12 MiB | `memory-disk` | 既に表示側 3 箇所が memory-disk。memory 成分を含むので先読みの目的は達成できる |
// | appleIcon / googleIcon | 512×512 | 各 1.00 MiB | `memory-disk` | 同上 |
//
// ⚠️ ポリシーを落としても **先読み対象からは外さないこと**。
// `e2e-web/utils/preload-assets.ts` の `PRELOAD_ASSET_PATTERNS` は 8 キー固定で、
// `e2e-web/tests/search/tutorial-preload.spec.ts` が完全一致を要求する。
// web の `<img>` fetch は cachePolicy に影響されない(#1087 設計 §4-5)ので、
// 「8 枚のまま描く / ポリシーだけアセット単位で変える」が正しい。
import type { ImageProps } from "expo-image";

type PreloadAssetDefinition = {
	/** `require()` したアプリ埋め込みアセット */
	source: ImageProps["source"];
	/** 先読み側・全表示側で共有する cachePolicy(#785) */
	cachePolicy: NonNullable<ImageProps["cachePolicy"]>;
};

export const PRELOAD_ASSETS = {
	// 検索チュートリアル画像(表示側: components/TutorialPage.tsx)
	tutorialPage1: { source: require("@/assets/images/tutorial/search-page1.webp"), cachePolicy: "disk" },
	tutorialPage2: { source: require("@/assets/images/tutorial/search-page2.webp"), cachePolicy: "disk" },
	tutorialPage3: { source: require("@/assets/images/tutorial/search-page3.webp"), cachePolicy: "disk" },
	tutorialPage4: { source: require("@/assets/images/tutorial/search-page4.webp"), cachePolicy: "disk" },
	// アプリアイコン画像(表示側: OpenInAppBanner / RestaurantLoading / TopicsLoading / ProfileHeader)
	appIcon: { source: require("@/assets/images/icon.webp"), cachePolicy: "memory-disk" },
	// レビュー機能のヒーロー画像(表示側: app/[locale]/(tabs)/review/index.tsx)
	reviewHero: { source: require("@/features/review/assets/review-hero.webp"), cachePolicy: "memory" },
	// Apple アイコン画像(表示側: LoginbackModal)
	appleIcon: { source: require("@/assets/images/logo_apple_icon.png"), cachePolicy: "memory-disk" },
	// Google アイコン画像(表示側: LoginbackModal)
	googleIcon: { source: require("@/assets/images/logo_google_g_icon.png"), cachePolicy: "memory-disk" },
} as const satisfies Record<string, PreloadAssetDefinition>;

/** 先読み対象アセットのキー */
export type PreloadAssetKey = keyof typeof PRELOAD_ASSETS;

/**
 * 先読み対象アセットのキー一覧。
 *
 * `PreloadImageDeck` はこれを map して 8 枚すべてを描く。
 * ここから要素を減らすと web の `tutorial-preload.spec.ts` が赤くなる。
 */
export const PRELOAD_ASSET_KEYS = Object.keys(PRELOAD_ASSETS) as PreloadAssetKey[];

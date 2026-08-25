/*
このファイルの責務
- 3 ステップオンボーディング（#1486 §1）の「1 ページ分の中身」をデータとして持つ。
- オンボーディングで使う画像を、先読み（#1486 §2）から 1 箇所で参照できるようにする。

#935 【設計】ラベルは **i18n のキー文字列**で持ち、`i18n.t()` は使う側で呼ぶこと。
モジュール評価時に `i18n.t()` を呼ぶと、その時点の言語で文字列が凍りつき、
あとから locale を切り替えても更新されない（features/search/constants.ts の同じ注意書きを参照）。
*/

/** 1 ページ分の定義。共感（課題）と解決の 2 フェーズぶんの文言と画像を持つ */
export type OnboardingStepConst = {
	/** 課題フェーズの一言（#1486 §1「課題の一言」） */
	problemKey: string;
	/** 解決フェーズの文言 */
	solutionKey: string;
	/** 共感用の写真（全面表示） */
	empathyImage: number;
	/** 解決の見せ方を表す画像（解決フェーズでフェード / ポップ表示） */
	solutionImage: number;
};

/**
 * #1486 §1 3 ステップの中身。
 *
 * 画像は #1486 §2 で確定した 6 枚。`assets/images/onboarding/` にローカルアセットとして置く
 *（ネットワーク取得にしないこと。ページ送りでロード待ちが出る）。
 *
 * | 種類 | 解像度 | 描き方 |
 * | --- | --- | --- |
 * | `*-empathy` | 941 × 1672（9:16） | 画面全面に `contentFit="cover"` |
 * | `*-solution` | 1080 × 1440（3:4・**背景が透過**） | 中央に `contentFit="contain"` |
 *
 * ⚠️ 解決画像の透過を潰さないこと。白いフレームだけを切り抜いた画像で、
 * 暗くした共感写真の上に重ねる前提になっている。差し替えは元画像を
 * `scripts/build-onboarding-images.py` に通すこと（リサイズと WebP 圧縮の条件が入っている）。
 */
export const ONBOARDING_STEPS = [
	{
		problemKey: "Onboarding.step1.problem",
		solutionKey: "Onboarding.step1.solution",
		empathyImage: require("@/assets/images/onboarding/step1-empathy.webp"),
		solutionImage: require("@/assets/images/onboarding/step1-solution.webp"),
	},
	{
		problemKey: "Onboarding.step2.problem",
		solutionKey: "Onboarding.step2.solution",
		empathyImage: require("@/assets/images/onboarding/step2-empathy.webp"),
		solutionImage: require("@/assets/images/onboarding/step2-solution.webp"),
	},
	{
		problemKey: "Onboarding.step3.problem",
		solutionKey: "Onboarding.step3.solution",
		empathyImage: require("@/assets/images/onboarding/step3-empathy.webp"),
		solutionImage: require("@/assets/images/onboarding/step3-solution.webp"),
	},
] as const satisfies readonly OnboardingStepConst[];

/**
 * オンボーディングで使う画像 6 枚。
 *
 * #1486 §2【要件】ページ送りでロード待ち・ちらつきが出ないよう、表示前に 6 枚すべてを
 * 先読み + デコードする。実際の先読みは検索画面末尾のオフスクリーンブロック
 *（app/[locale]/(tabs)/search/index.tsx の `PRELOAD_IMAGES`）が担う。
 *
 * ⚠️ ここに画像を足したら e2e-web/utils/preload-assets.ts の
 * `PRELOAD_ASSET_PATTERNS` も必ず更新すること（枚数の一致を E2E が検査している）。
 */
export const ONBOARDING_IMAGES = ONBOARDING_STEPS.flatMap((step) => [step.empathyImage, step.solutionImage]);

/**
 * 課題文が «下から上へ» フェードインする時間。
 *
 * #1486【設計】ページを開いた **と同時に** 再生する。当初は「約 1.5 秒後に自動で
 * 解決フェーズへ切り替える」仕様だったが、読み終わる前に画面が変わるという指摘を受けて
 * 解決フェーズは «矢印ボタンを押したとき» だけに変わった（`PROBLEM_PHASE_DURATION_MS` は廃止）。
 * その結果、課題フェーズには «何かが起きた» という手がかりが無くなるため、
 * 入りのモーションをここへ持たせている。
 */
export const PROBLEM_INTRO_DURATION_MS = 420;

/** 課題文のフェードインで «下から» 持ち上げる距離（px） */
export const PROBLEM_INTRO_TRANSLATE_Y = 24;

/**
 * ページ番号を必ずページ範囲内へ収める。
 *
 * #1486 【バグ】**「次へ」の連打で範囲外へ出る。** 待機を挟まない連打では、
 * 3 回のハンドラが **同じ `stepIndex`** を読む（React は discrete event の更新を
 * 各ハンドラの終わりにコミットするが、同一タスク内で連続して届いたプレスは
 * 直前の再描画を挟まない）。そのため `isLastStep` はどれも false のまま
 * `setStepIndex((i) => i + 1)` が 3 回走り、添字が 3 になる。
 *
 * `ONBOARDING_STEPS[3]` は `undefined` なので、そのまま描画すると
 * `step.empathyImage` で落ちて **画面が丸ごと消える**（e2e-web の
 * tests/search/onboarding.spec.ts の連打テストが実際にこれを捕まえた）。
 *
 * 旧チュートリアルも `handleNextPage` で `Math.min` によるクランプを持っていた。
 * 実装を作り直すときに落ちた «同じ罠» なので、関数として名前を付けて共有しておく。
 */
export const clampStepIndex = (index: number): number => Math.min(Math.max(index, 0), ONBOARDING_STEPS.length - 1);

/** #1486 §1 解決フェーズの登場アニメーションの長さ（「約 300ms 程度を目安」） */
export const SOLUTION_REVEAL_DURATION_MS = 300;

/** #1486 §1 解決フェーズで背景写真にかける黒の半透明オーバーレイ */
export const SOLUTION_OVERLAY_COLOR = "rgba(0, 0, 0, 0.55)";

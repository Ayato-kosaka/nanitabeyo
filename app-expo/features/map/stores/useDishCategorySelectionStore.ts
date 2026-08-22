import { createWithEqualityFn } from "zustand/traditional";

/**
 * 料理カテゴリ選択画面（`app/[locale]/restaurant/[restaurantId]/dish-category.tsx`）が
 * 返す «結果»。
 *
 * - `selected`: オートコンプリートの候補を選んだ（既存カテゴリ）
 * - `typed`: 候補を選ばずに文字を入れたまま画面を離れた（新規カテゴリの作成候補）
 */
export type DishCategorySelectionResult =
	| { status: "selected"; dishCategoryId: string; label: string }
	| { status: "typed"; name: string };

type DishCategorySelectionStore = {
	/** 未消費の結果。ReviewForm が読み取ったら必ず `clear()` すること */
	result: DishCategorySelectionResult | null;
	setResult: (result: DishCategorySelectionResult) => void;
	clear: () => void;
};

/**
 * 🍜 #1386 【設計】料理カテゴリ選択の «戻り値» を運ぶための最小のストア。
 *
 * 料理カテゴリ選択は `ReviewForm` の中の `DishCategoryModal`（BlurModal・**既定 zIndex 1100**）だった。
 * 親（レビュー投稿モーダル）は 1200 だったので **子の方が数字が小さい**（#1350 §D で挙げた逆転）。
 * ルートへ移すと重なり順は Navigator が持つのでこの問題は消えるが、代わりに
 * 「選んだ結果をどうやって前の画面へ返すか」という別の問題が出る。
 *
 * expo-router に «画面の戻り値» の仕組みは無い（`router.back()` は値を運べない）。
 * URL パラメータで返すには前の画面へ `setParams` する必要があり、ReviewForm は 2 つのルート
 *（`review` / `review-from-media`）で使われるため、どちらから来たかを知る必要が出てしまう。
 * そこで «1 件だけの受け渡し箱» をストアに置き、読んだ側が消す（consume）形にした。
 *
 * ## なぜ ReviewForm 側で «消す» のか
 * 残したままだと、次にフォームを開いたときに前回の選択が勝手に入る。
 * 開く直前にも `clear()` を呼ぶ（`ReviewForm` の `handleOpenDishCategory`）ので、
 * 「押した → 選ばずに戻った」ときに古い結果が蘇ることもない。
 *
 * ## なぜ「新規作成」をここでやらないのか
 * 候補に無い名前は `POST` でカテゴリを作る必要があるが、失敗時のインラインエラーと
 * 「処理中」表示はフォーム側の UI である。API 呼び出しをフォームに残せば、
 * 選択画面はもう表示されていないのにエラーだけ出るという状態を作らずに済む。
 */
export const useDishCategorySelectionStore = createWithEqualityFn<DishCategorySelectionStore>(
	(set) => ({
		result: null,
		setResult: (result) => set({ result }),
		clear: () => set({ result: null }),
	}),
	Object.is,
);

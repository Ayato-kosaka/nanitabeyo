import { strict as assert } from "node:assert";

import { by, element, launchAppWithSession } from "../../fixtures/e2e";
import { SearchScreen } from "../../screens/SearchScreen";
import { DishCategoriesScreen } from "../../screens/DishCategoriesScreen";
import { DISH_CATEGORY_CARD_GUTTER_RATIO } from "@app-expo/features/dishCategories/carouselLayout";

/**
 * 📐 候補カルーセルの横余白撤去(#1212)の回帰テスト(実 API / ネイティブ)
 *
 * 対応する e2e-web: e2e-web/tests/search/dishCategory-card-full-bleed.spec.ts
 *
 * 背景: `useDishCategoryCardSize()` は既定で左右16pxずつ(計32px)の余白を残した
 * `contentWidth - 32` を返す。dishCategories.tsx の候補カルーセルだけは `fullBleed: true` を渡し、
 * 余白ゼロ(=画面幅そのまま)の値を使うよう変更した(app-expo/features/dishCategories/hooks/useDishCategoryCardSize.ts)。
 * native には CenteredAppShell の中央カラムが無いため、`useContentWidth()` は常に画面幅そのものを
 * 返す(= web の「中央カラム幅」と同じ位置づけの値が、native では「画面幅」になる)。
 *
 * Carousel(react-native-reanimated-carousel)は `style.width` を「カード幅」
 * 「スナップ間隔(size)」「クリップする外側コンテナ幅」の3箇所すべてに使うため、
 * 値が1つずれるとスワイプ後にアクティブカードが画面中央からずれて止まる恐れがある。
 * 見た目の印象ではなく、カード幅とスワイプ後の位置を数値で固定する。
 *
 * 観測点: `dish-categories-tutorial-target-swipe`(app-expo/features/dishCategories/components/DishCategoryCard.tsx)。
 * `tutorialTargetRefs` は dishCategories.tsx が isActiveCard のときにしか渡さないため、
 * この testID は**アクティブなカード1枚にだけ**存在する(前後の事前描画カードには付かない)。
 * DishCategoriesScreen.ts には無い testID のため、この spec 専用にローカルで matcher を持つ。
 *
 * ⚠️ このファイルは型検査のみ確認しており、Detox では未実行(ビルド25分+起動のため今回の作業では
 * 実行しない。#1212 PR 本文に明記)。
 */

/** `getAttributes()` から取り出した矩形(iOS は pt / Android は物理ピクセル。同一端末内の比較にのみ使う) */
type Frame = { x: number; y: number; width: number; height: number };

/**
 * 指定インデックスの要素の矩形を読む。一致が無ければ null(例外にはしない)。
 *
 * `getAttributes()` の戻り値は「単一一致」と「複数一致(`{ elements: [...] }`)」の2形があり、
 * 複数一致形は iOS でしか返らない(tests/mutation/notifications-safe-area.test.ts と同じ理由・同じ形)。
 */
async function frameAt(matcher: Detox.NativeMatcher, index: number): Promise<Frame | null> {
	try {
		const attributes = await element(matcher).atIndex(index).getAttributes();
		const single = "elements" in attributes ? attributes.elements[0] : attributes;
		return single?.frame ?? null;
	} catch {
		// 一致が無い場合 Detox は例外を投げる。呼び出し側が判断できるよう null を返す
		return null;
	}
}

describe("候補カルーセルのカード幅とスナップ位置(#1212)", () => {
	const search = new SearchScreen();
	const dishCategories = new DishCategoriesScreen();
	/** アクティブなカードの swipe area(前後の事前描画カードには付かない。上記コメント参照） */
	const activeSwipeArea = by.id("dish-categories-tutorial-target-swipe");
	/** カルーセルの器。**等倍で描かれる**ので、スワイプはここを掴む（#1785。下のコメント参照） */
	const carouselContainer = by.id("dish-categories-carousel");

	beforeAll(async () => {
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();

		// 場所だけを確定させる(時間帯 lunch / 同行者 solo には初期値があるため追加選択は不要。
		// tests/search/dish-categories-flow.test.ts と同じ手順)
		await search.clearLocationIfPresent();
		await search.typeLocation("渋谷");
		await search.selectLocationSuggestion(0);
		await search.submit();
		await dishCategories.expectLoaded();
	});

	// ─ テストケース: カードは画面幅そのものから作られている(左右 16px の余白が無い) ─
	// 手順:
	//   1. beforeAll でトピック画面に到達済み
	//   2. アクティブなカードの swipe area の矩形(frame)を読む
	//   3. 左端の余白比率(frame.x / frame.width)が **parallax の scale から決まる比**に
	//      収まっていることを検証する
	// 余白比率で比較するのは、iOS(pt)/Android(物理ピクセル)で単位が異なっても同じ閾値で
	// 判定できるようにするため。
	//
	// ⚠️ **比率はゼロにはならない**(#1785)。`parallax` はアクティブなカードにも `scale` を
	//    掛けるので、カードを画面幅いっぱいに作っても描画は `scale` 倍され、その差の半分が
	//    左右に空く。これは #1629 でオーナーが «直す必要はない» と確定した挙動である
	//    (`scale: 1` にした変更は差し戻し済み。commit 18df368e)。
	//    #1212 が消したのは «カードの寸法に入っていた左右 16px» の方であり、ここが守るのはそちら。
	//    16px が戻ると比率は端末幅 360px 相当で約 11% になり、この閾値を明確に超える。
	//    期待値は写経せず `DISH_CATEGORY_CARD_GUTTER_RATIO` から引く。
	it("カード幅は画面幅から作られている(左右の余白が無い)", async () => {
		const frame = await frameAt(activeSwipeArea, 0);
		assert.ok(frame, "アクティブなカードの swipe area (dish-categories-tutorial-target-swipe) が見つかりません");

		const gutterRatio = frame.x / frame.width;
		assert.ok(
			gutterRatio < DISH_CATEGORY_CARD_GUTTER_RATIO + 0.02,
			[
				"カード左端に余白が残っています(#1212 の再発)。",
				`  frame.x=${frame.x} frame.width=${frame.width} 比率=${gutterRatio}`,
				`  parallax の scale から決まる比は ${DISH_CATEGORY_CARD_GUTTER_RATIO}（+0.02 まで許容）。`,
				"  useDishCategoryCardSize({ fullBleed: true }) が正しく渡っているか確認してください。",
			].join("\n"),
		);
	});

	// ─ テストケース: スワイプ後もカードは画面中央のスナップ位置で止まる ─
	// 手順:
	//   1. アクティブなカードの矩形を記録する
	//   2. カード上を左へスワイプして隣のカードへ切り替える
	//   3. スナップアニメーション完了を待ち、新しくアクティブになったカードの矩形を読む
	//   4. 横位置(x)のズレが無視できるほど小さいことを検証する
	// #1212 の本題: Carousel は style.width を「カード幅」「スナップ間隔」「クリップ幅」の3箇所に
	// 使うため、fullBleed 化でこの3値が1つでもズレるとスワイプ後に中心から外れて止まる。
	it("スワイプ後もカードは画面中央のスナップ位置で止まる(横位置がズレない)", async () => {
		const beforeFrame = await frameAt(activeSwipeArea, 0);
		assert.ok(beforeFrame, "スワイプ前のアクティブなカードの swipe area が見つかりません");

		// ⚠️ **カードそのものを掴まないこと**（#1785）。`parallax` はアクティブなカードを
		//    `scale` 倍に描くので、Espresso の «対象が 90% 以上見えていること» を構造的に
		//    満たせない（実測 81% で "Action will not be performed" になる）。
		//    等倍で描かれる器（カルーセルのコンテナ）を掴む。スワイプの届く先は同じである
		await element(carouselContainer).atIndex(0).swipe("left", "fast", 0.75);

		// reanimated のスナップアニメーション完了を待つ。画面遷移を伴わない操作のため、
		// Detox の同期機構だけでは完了を検知できず、アニメーション時間ぶんを明示的に待つ
		await new Promise((resolve) => setTimeout(resolve, 600));

		const afterFrame = await frameAt(activeSwipeArea, 0);
		assert.ok(afterFrame, "スワイプ後のアクティブなカードの swipe area が見つかりません");

		const xDriftRatio = Math.abs(afterFrame.x - beforeFrame.x) / afterFrame.width;
		assert.ok(
			xDriftRatio < 0.01,
			[
				"スワイプ前後でカードの横位置がズレています(#1212 のスナップ位置回帰)。",
				`  before.x=${beforeFrame.x} after.x=${afterFrame.x} width=${afterFrame.width} 比率=${xDriftRatio}`,
			].join("\n"),
		);
	});
});

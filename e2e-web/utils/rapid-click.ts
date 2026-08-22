import type { Locator, Page } from "@playwright/test";

/**
 * 👆👆 「待機を挟まない連打」を再現するユーティリティ（#1084 / #1086 / #1090）
 *
 * ## なぜ `locator.click()` のループにしないか
 * `click()` は毎回 actionability チェック（可視・安定・enabled・hit-target）を通るため、
 * タップの間に必ず待機が挟まり「連打」の再現にならない。加えて 1 発目で画面遷移が走ると
 * 2 発目の `click()` は "element is not attached to the DOM" で落ち、
 * **連打事故の有無と無関係に赤くなる**。
 *
 * ## なぜ `page.mouse.down()/up()` を使わないか（#1086 で実測して差し替え）
 * `page.mouse` の 1 発ごとに CDP のラウンドトリップが挟まり、その隙にレンダラが
 * React のコミット（＝ 画面遷移）を流し切ってしまう。結果 2 発目以降は
 * **もうハンドラへ届かない**。`handleSearch` の多重検索防止ガードを外しても
 * レコメンド API は 1 回・トピック画面も 1 枚のままで、**感度がゼロ**だった
 * （N=2 でも N=3 でも同じ。#1086 のレビューで実測）。
 *
 * `evaluate()` の中でループすれば全発が 1 つの JS タスクとして届く。
 * 実測では N=2 / N=5 のいずれでも、ガードを外すと API 呼び出しと積み上がる
 * トピック画面が N 枚になった（= 事故を再現できる）。
 *
 * ## dispatch するイベントの順序
 * react-native-web の Pressable は pointer イベントから onPress を組み立てるため、
 * `click` 単発では届かない。**`pointerdown` → `pointerup` → `click` の順で**送ること。
 *
 * ⚠️ ブラウザ側で動く dispatch ループは `evaluate` に閉じている必要があるため、
 * このファイル内で 2 回だけ同じ手順を書いている（外側の関数を参照するとシリアライズできない）。
 * 片方だけ直すと連打の再現性が食い違うので、**必ず両方を揃えて変更すること**。
 */

/**
 * 対象要素へ「同一 JS タスク内で」合成 pointer イベントを `times` 回 dispatch する。
 *
 * 要素参照を先に解決して同じ要素へ打ち続けるため、1 発目で画面が切り替わって
 * 対象が DOM から外れても残りの dispatch は落ちない（「遷移してしまった」という
 * 検証したい事象そのものを再現できる）。
 *
 * @param locator 連打対象
 * @param times 連打回数
 */
export async function clickRapid(locator: Locator, times: number): Promise<void> {
	await locator.evaluate((element, count: number) => {
		const rect = element.getBoundingClientRect();
		const base = {
			bubbles: true,
			cancelable: true,
			composed: true,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
			button: 0,
		};
		const pointer = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true };

		for (let i = 0; i < count; i += 1) {
			element.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
			element.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
			element.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
		}
	}, times);
}

/**
 * `data-testid` で指定した要素が **その瞬間に描画されていれば** `times` 回だけ押す（#1086 / #1091）。
 *
 * {@link clickRapid} との違いは **要素の特定までブラウザ側で行う**こと。
 * Playwright 側で Locator を解決してから実際にイベントが届くまでの間に、対象が
 * 別ノードへ化ける／消えることがある画面で使う。
 *
 * 具体例（#1086 / #1091）: 旧検索チュートリアルのプライマリ CTA は **単一の DOM ノード**で、
 * testID だけが `search-tutorial-next` ↔ `search-tutorial-finish` と入れ替わる実装だった。
 * ページ送りアニメーション中は `onViewableItemsChanged` が `currentPage` を揺らすため、
 * 「つぎへ」として解決したノードがクリック到達時には「はじめよう」へ化けていることがあった。
 * 特定とイベント送出を **同一 JS タスク内**で行えば、この取り違えは構造的に起こり得ない。
 *
 * ⚠️ #1486 でその実装は無くなった（新オンボーディングの「前へ」「次へ」「スキップ」は
 * それぞれ独立したノードで、押しても別の testID へ化けない）。この関数は
 * «同じ壊れ方をする画面» が再び現れたときのために残してある。
 *
 * @param page 対象ページ
 * @param testId `data-testid` の値
 * @param times 押す回数（既定 1）
 * @returns 押した場合 true / 要素が無かった場合 false
 */
export async function pressByTestIdIfPresent(page: Page, testId: string, times = 1): Promise<boolean> {
	return page.evaluate(
		({ id, count }: { id: string; count: number }) => {
			const element = document.querySelector(`[data-testid="${id}"]`);
			if (!element) return false;

			const rect = element.getBoundingClientRect();
			const base = {
				bubbles: true,
				cancelable: true,
				composed: true,
				clientX: rect.left + rect.width / 2,
				clientY: rect.top + rect.height / 2,
				button: 0,
			};
			const pointer = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true };

			for (let i = 0; i < count; i += 1) {
				element.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
				element.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
				element.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
			}
			return true;
		},
		{ id: testId, count: times },
	);
}

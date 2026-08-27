/*
#1629【30】オーナー実機報告:

> このお店提案は 5 件しか表示されないんで、今の状態だとチカチカするんですよね。
> 今までこのお店提案はそんな性能が悪かったことないんで、そういう先読みは
> あえて入れてないんですよ。むしろチカチカして見にくい。

`useDishMediaBackgroundImageResources` は **集合から外れた画像を release する**。
窓を動かすと、外れた画像は破棄され、戻ってきたときに取り直しになる。
件数が窓より少し多いだけの画面（お店提案は 5 件）では、指を動かすたびに
**取得 → 破棄 → 取得** が繰り返される。これが «チカチカ» の正体だった。
枚数を 4 から 2 へ減らしても、窓が動く限り churn は消えない。

ここで固定するのは 1 点:
**小さい一覧では、指を動かしても先読み集合が «同じ参照» のまま変わらない。**
（参照が変われば下流の hook が作り直され、release が走る）
*/
import { computePreloadIds } from "../preloadWindow";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

describe("#1629【30】小さい一覧では窓を作らない", () => {
	it("お店提案の 5 件では、どの位置でも同じ配列（同じ参照）を返す", () => {
		const list = ids(5);
		const first = computePreloadIds(list, 0);
		expect(first).toBe(list); // 参照が同じ = 下流が作り直されない
		for (let i = 1; i < list.length; i++) {
			expect(computePreloadIds(list, i)).toBe(first);
		}
	});

	it("8 件までは全件（境界）", () => {
		const list = ids(8);
		expect(computePreloadIds(list, 3)).toBe(list);
	});

	// ⚠️ 大きい一覧まで «全件先読み» にしてはいけない。#802 で 42 枚の全画面ビットマップを
	//    同時に取得・デコードし、Android では Glide の timeout を踏んでいた
	it("9 件以上では窓で切る（前 1 / 後 2）", () => {
		const list = ids(20);
		expect(computePreloadIds(list, 10)).toEqual(["id-9", "id-10", "id-11", "id-12"]);
		expect(computePreloadIds(list, 0)).toEqual(["id-0", "id-1", "id-2"]);
	});

	it("大きい一覧では位置が変わると集合も変わる（窓が効いている証明）", () => {
		const list = ids(20);
		expect(computePreloadIds(list, 5)).not.toEqual(computePreloadIds(list, 10));
	});
});

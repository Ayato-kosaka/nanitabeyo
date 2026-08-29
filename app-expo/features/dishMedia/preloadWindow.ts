/*
#1629【30】全画面フィードで «背景画像を先読みする範囲» を決める。

## なぜ別ファイルなのか

`DishMediaFeed.tsx` は `expo-video` を import しており、jest から素直に読めない
（`VideoPlayer.tsx` の評価で落ちる）。**判断のロジックだけを純粋関数として切り出し**、
テストから直接叩けるようにしてある。

## 何を決めているのか

`useDishMediaBackgroundImageResources` は **集合から外れた画像を release する**。
つまり «窓» を動かすと、外れた画像は破棄され、戻ってきたときに取り直しになる。

オーナー実機報告（2026-08-27）:

> このお店提案は 5 件しか表示されないんで、今の状態だとチカチカするんですよね。
> 今までこのお店提案はそんな性能が悪かったことないんで、そういう先読みは
> あえて入れてないんですよ。むしろチカチカして見にくい。

件数が窓より少し多いだけの画面では、指を動かすたびに **取得 → 破棄 → 取得** が
繰り返される。これが «チカチカ» の正体である。**枚数を減らしても、窓が動く限り消えない。**

そこで **全部が窓に収まる規模なら窓を作らない**。`ids` をそのまま返すので参照が変わらず、
下流の hook が作り直されないため release も走らない。これは release/1.13 の
«ids 全件を渡す» 挙動と、この規模では同一である。
*/

/** 背景画像を先読みする «戻る側» の枚数。もう見たページなので 1 枚で足りる */
export const PRELOAD_BEHIND = 1;

/** 背景画像を先読みする «進む側» の枚数。窓を使うときだけ効く */
export const PRELOAD_AHEAD = 2;

/**
 * **これ以下の件数なら «窓» を作らず全件を先読み対象にする。**
 *
 * 8 は «窓（前 1 + 後 2 + 自分 = 4）の 2 倍» で、お店提案の 5 件を確実に含む。
 *
 * ⚠️ ここを大きくしすぎないこと。#802 の時点で ids 全件（my-dishes 経由だと 42 件）を
 *    同時に `Image.loadAsync` しており、開いた瞬間に全画面ビットマップ 42 枚の取得・
 *    デコードが一斉に走って Android では Glide の timeout まで踏んでいた。
 */
export const PRELOAD_ALL_MAX = 8;

/**
 * 先読み対象の id を返す。
 *
 * 件数が {@link PRELOAD_ALL_MAX} 以下なら **`ids` をそのまま返す**（同じ参照）。
 * 呼び出し側の `useMemo` の下流が作り直されないので、release ＝
 * «取得 → 破棄 → 取得» の churn が起きない。
 */
export function computePreloadIds(ids: string[], currentIndex: number): string[] {
	if (ids.length <= PRELOAD_ALL_MAX) return ids;
	const start = Math.max(0, currentIndex - PRELOAD_BEHIND);
	return ids.slice(start, currentIndex + PRELOAD_AHEAD + 1);
}

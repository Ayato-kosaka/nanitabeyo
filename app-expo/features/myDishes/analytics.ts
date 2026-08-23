import type { MyDishesFilter } from "./stores/useMyDishesFilterStore";

/**
 * #1403 (PR2) my-dishes の意思決定を計測するための **イベント名と payload の一元管理**。
 *
 * ## この PR の立ち位置
 *
 * 計測はゼロから入れるのではない。#1396〜#1398 が既に `logFrontendEvent` を各所へ入れており、
 * ここでの仕事は **棚卸しして欠けを埋め、命名と payload を揃える**ことである。
 * 新しいログ基盤は作らない。送信経路は従来どおり `useLogger().logFrontendEvent`
 * （→ `lib/logQueue` → `frontend_event_logs`）1 本だけである。
 *
 * ## 3 つの原則
 *
 * ### 1. `error_level` は意思決定なら必ず `"log"`
 *
 * ここに並ぶイベントは «ユーザーが何を選んだか» であって障害ではない。`"error"` にすると
 * エラー監視（error-triage）が誤検知で埋まる。失敗の記録は別イベント（`*_error`）で出す。
 *
 * ### 2. payload に個人を特定しうる値を入れない
 *
 * | 入れる | 入れない |
 * | --- | --- |
 * | `restaurantId` / `itemKey` / `dishMediaId` / `chipId` などの id | 店名・料理名・レビュー本文 |
 * | `status` / `sort` / `featureKeys` のような列挙値 | ユーザー名・メールアドレス |
 * | `hasArea` / `hasPeriod` のような真偽 | 生の緯度経度（→ {@link roundCoordinateForLog} で丸める） |
 * | 件数・所要時間 | 端末位置そのもの |
 *
 * 店名・料理名は id から後段で引ける。ログに実名を落とすと、`frontend_event_logs` を読む
 * 全員が «誰がどこで何を食べたか» を素の文字列で見られる状態になる。id で済ませる。
 *
 * ### 3. レンダーごとに出さない
 *
 * フィルタは「適用したとき」だけ 1 回出す。チップを押すたび・Map を動かすたびには出さない。
 * my-dishes のフィルタは押すたびに約 964MB の `dish_reviews` を叩きうる形（#1395 §0(A)）で、
 * ドラフト編集 →「適用」で 1 回だけ確定する作りになっている。ログもその境界に合わせる。
 * `__tests__/myDishesAnalytics.test.tsx` が「適用したときだけ 1 回出る」を固定している。
 *
 * ## ⚠️ import 完了（SNS 取り込み）の計測はここに «まだ» 無い
 *
 * #1399 の SNS 取り込み自体が未実装なので、この PR では仕込まない。入れるべき場所と形は
 * PR 本文へ書き残してある（取り込み «完了» の 1 点。URL そのものは payload に入れない）。
 */

/**
 * my-dishes が出すイベント名の唯一の定義。
 *
 * 文字列リテラルを各画面へ散らさないのは、`my_dishes_record_button_clicked` のように
 * 1 箇所だけ語尾が揃っていないものが混ざった実績があるためである（この PR で
 * `my_dishes_record_pressed` へ揃えた）。命名は次の規則に従う。
 *
 * - 接頭辞は `my_dishes_`（`frontend_event_logs` を event_name の前方一致で絞れるようにする）
 * - 語尾は **`_pressed`（押した）/ `_selected`（選んだ）/ `_applied`（適用した）/
 *   `_completed`（完了した）/ `_cleared`（解除した）** のいずれか。`_clicked` は使わない
 *   （タップ操作が主で、web の click とは限らないため）
 */
export const MY_DISHES_EVENTS = {
	/** 一覧の行を選んだ（Feed または店舗詳細へ） */
	listItemSelected: "my_dishes_list_item_selected",
	/** Map のピンを押した（Sheet が開く。ここでは画面遷移しない） */
	mapPinSelected: "my_dishes_map_pin_selected",
	/** Map の「このエリアで再検索」= エリアの確定 */
	mapSearchThisArea: "my_dishes_map_search_this_area",
	/** Map からエリア絞り込みを解除した */
	mapAreaCleared: "my_dishes_map_area_cleared",
	/** Sheet のヘッダ（店名）から店舗詳細へ */
	sheetRestaurantSelected: "my_dishes_sheet_restaurant_selected",
	/** Sheet の行を選んだ */
	sheetItemSelected: "my_dishes_sheet_item_selected",
	/** Sheet を展開して全画面 Feed へ */
	sheetExpanded: "my_dishes_sheet_expanded",
	/** Sheet から一覧ビューへ戻った */
	sheetSeeAllInList: "my_dishes_sheet_see_all_in_list",
	/** Calendar の日を選んだ（= その日で期間を絞る） */
	calendarDaySelected: "my_dishes_calendar_day_selected",
	/** Calendar から期間絞り込みを解除した */
	calendarPeriodCleared: "my_dishes_calendar_period_cleared",
	/** フィルタ編集画面で「適用」を押した。**チップ押下では出さない** */
	filterApplied: "my_dishes_filter_applied",
	/** 3 ビュー（map / list / calendar）を切り替えた。同じビューを押しても出さない */
	viewSelected: "my_dishes_view_selected",
	/** 全画面 Feed の chip を適用した */
	feedChipApplied: "my_dishes_feed_chip_applied",
	/** 全画面 Feed の chip をスナックバーから取り消した */
	feedChipUndone: "my_dishes_feed_chip_undone",
	/** 全画面 Feed を閉じた */
	feedClosed: "my_dishes_feed_closed",
	/** 記録ボタン（FAB）を押した */
	recordPressed: "my_dishes_record_pressed",
	/** want 行の「食べたを記録」を押した（= 保存→食べた 遷移の **入口**） */
	markAsEatenPressed: "my_dishes_mark_as_eaten_pressed",
	/** その記録が実際に完了した（= 保存→食べた 遷移の **出口**）。{@link markAsEatenFunnel} 参照 */
	markAsEatenCompleted: "my_dishes_mark_as_eaten_completed",
} as const;

export type MyDishesEventName = (typeof MY_DISHES_EVENTS)[keyof typeof MY_DISHES_EVENTS];

/**
 * 「食べたを記録」の押下元。`my_dishes_mark_as_eaten_pressed` の `from` と、
 * 完了イベントの `from` は同じ値域を使う（入口と出口を同じ軸で突き合わせるため）。
 */
export type MarkAsEatenOrigin = "list" | "sheet";

/**
 * ログに載せる座標の小数桁。3 桁 ≈ 110m 四方までしか分からない粒度。
 *
 * 「どのあたりのエリアで絞ったか」を集計するには十分で、自宅や勤務先を特定するには足りない。
 * 絞り込みの実行そのもの（`commitArea`）は生の値を使う。**丸めるのはログだけ**である。
 */
export const LOG_COORDINATE_PRECISION = 3;

/**
 * 座標をログ用の粒度へ丸める。`-0` は `0` に正規化する（集計時に 2 種類の 0 を作らないため）。
 */
export const roundCoordinateForLog = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	const rounded = Number(value.toFixed(LOG_COORDINATE_PRECISION));
	return rounded === 0 ? 0 : rounded;
};

/**
 * `my_dishes_map_search_this_area` の payload。
 *
 * `radius` は丸めない。半径はユーザーの居場所ではなく「どのくらい広く探したか」であり、
 * ここを潰すと «エリア絞り込みが広すぎて 0 件になっていないか» を後から追えなくなる。
 */
export const buildMapAreaPayload = (area: { lat: number; lng: number; radius: number }) => ({
	lat: roundCoordinateForLog(area.lat),
	lng: roundCoordinateForLog(area.lng),
	radius: area.radius,
});

/**
 * `my_dishes_filter_applied` の payload。**「適用」を押したときにだけ**組み立てる。
 *
 * 「どの絞り込みを使ったか」を答えられる粒度まで載せる。#1396 で入った時点では
 * `featureKeys`（当時は `sceneKey` / `timeSlotKey`）/ `ratings` / `categoryIds` が落ちており、
 * 「並び替えとして出したシーン・時間帯（確定B）が実際に使われているか」を答えられなかった。
 *
 * エリアは `hasArea` の真偽だけにする。座標は `my_dishes_map_search_this_area` 側に
 * 丸めた形で載っており、フィルタ適用のたびに同じ座標を重ねて撒く必要がない。
 */
export const buildFilterAppliedPayload = (filter: MyDishesFilter) => ({
	/** `""` は「両方（= 未指定）」。`status: []` の既定値がそのまま空文字になる */
	status: filter.status.join(","),
	sort: filter.sort,
	minRating: filter.minRating,
	/** ★n のみ（multi）を使ったか。選んだ星の中身までは要らない */
	hasRatings: filter.ratings.length > 0,
	/** 料理カテゴリの id は載せず件数だけにする（絞り込みの «強さ» が分かれば足りる） */
	categoryCount: filter.categoryIds.length,
	/**
	 * 確定B の並び替えに同伴する軸（`"<feature_type>:<feature_key>"`）。
	 * 列挙値なので id 同様そのまま載せてよい。選んだ順で値が変わらないようソートして積む
	 */
	featureKeys: [...filter.featureKeys].sort().join(","),
	hasArea: filter.area !== null,
	hasPeriod: filter.from !== null || filter.to !== null,
});

/**
 * `my_dishes_view_selected` の payload。`from` → `to` で «どこからどこへ» 移ったかを見る。
 * 遷移元が要るのは「Map を見てから一覧へ落ちる」のような順序が主要な観察対象だからである。
 */
export const buildViewSelectedPayload = (from: string, to: string) => ({ from, to });

/**
 * `my_dishes_mark_as_eaten_completed` の payload。
 *
 * `durationMs` は「食べたを記録」を押してから記録が完了するまでの実測値である。
 * 入口（`my_dishes_mark_as_eaten_pressed`）と出口を後から join しなくても、
 * 1 行で «押した人のうち何割が何秒で書き終えたか» を出せるようにしている。
 *
 * `dishReviewId` まで載せるのは、完了イベントが二重に出ていないかを id で潰せるようにするため。
 * レビュー本文・評点は載せない（本文は個人を特定しうるし、評点は別経路で取れる）。
 */
export const buildMarkAsEatenCompletedPayload = (input: {
	from: MarkAsEatenOrigin;
	itemKey: string;
	restaurantId: string;
	dishMediaId: string;
	dishReviewId: string;
	durationMs: number;
}) => ({
	from: input.from,
	itemKey: input.itemKey,
	restaurantId: input.restaurantId,
	dishMediaId: input.dishMediaId,
	dishReviewId: input.dishReviewId,
	durationMs: input.durationMs,
});

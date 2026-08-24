import type { MyDishItem } from "@shared/api/v1/res";
import { resolveMyDishThumbnailUrl } from "./thumbnail";

/**
 * #1396 Calendar ビュー（設計書 (2/2) §4）の純ロジック。
 *
 * ## なぜ「日付ライブラリ」も「カレンダーライブラリ」も足さないのか（§4-1）
 *
 * 必要なのは「7 列の日グリッド + サムネイル」だけで、祝日・週番号・範囲選択といった
 * ライブラリの本体機能を 1 つも使わない。`package.json` を増やすと react-native-web での
 * 動作検証コストが乗るため、`Date` だけで組む。
 *
 * ## バケットの基準は `occurredAt`（#1395 §6 / §4-4）
 *
 * サーバは集約しない。クライアントが `occurredAt`（ISO8601 / UTC）を**端末のローカル
 * タイムゾーン**で `YYYY-MM-DD` に落として日バケットへ入れ、`YYYY-MM` で月へ束ねる。
 * `savedAt` / `eatenAt` ではなく `occurredAt` を使うこと（`MyDishItem.occurredAt` の
 * docstring のとおり、want 行では `savedAt` と食い違うことがある）。
 *
 * ## 遡りの終端は `meta.oldestOccurredAt`（§4-4）
 *
 * 月は「読み込み済みの最古の月」までしか生成しない。さらに `oldestOccurredAt` が
 * 分かっている場合は**それより古い月を 1 つも作らない**。これを守らないと、
 * inverted リストが「常に上へ伸びる」状態になり `onEndReached` が止まらなくなる。
 */

/** 月の生成上限（暴走防止の最後の砦。50 年ぶんあれば実データでは当たらない） */
export const MAX_CALENDAR_MONTHS = 600;

/** 週の始まりは日曜固定。ロケール別週初日はライブラリ機能なので採らない（§4-1） */
export const CALENDAR_WEEK_START = 0;

export const CALENDAR_WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type CalendarDayCell = {
	/** ローカルタイムゾーンの `YYYY-MM-DD` */
	dateKey: string;
	/** 1-31 */
	day: number;
	/** その日の記録（クエリの並び順のまま）。先頭が代表サムネイル */
	items: MyDishItem[];
};

export type CalendarMonth = {
	/** `YYYY-MM` */
	ym: string;
	year: number;
	/** 1-12 */
	month: number;
	/** 7 の倍数。前後の埋めは null */
	cells: (CalendarDayCell | null)[];
	/** その月の記録件数（0 の月も月グリッド自体は描く。§4-3) */
	itemCount: number;
};

const pad2 = (value: number): string => (value < 10 ? `0${value}` : String(value));

/** `Date` → ローカルの `YYYY-MM-DD` */
export const toLocalDateKey = (date: Date): string =>
	`${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** `Date` → ローカルの `YYYY-MM` */
export const toYearMonth = (date: Date): string => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;

/** ISO8601 → ローカルの `YYYY-MM-DD`。壊れた値は null（1 行のせいで月グリッド全体を落とさない） */
export const isoToLocalDateKey = (iso: string | null | undefined): string | null => {
	if (!iso) return null;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	return toLocalDateKey(date);
};

/** ISO8601 → ローカルの `YYYY-MM`。壊れた値は null */
export const isoToYearMonth = (iso: string | null | undefined): string | null => {
	const dateKey = isoToLocalDateKey(iso);
	return dateKey ? dateKey.slice(0, 7) : null;
};

/** `YYYY-MM` を `delta` ヶ月ずらす（負で過去へ） */
export const addMonths = (ym: string, delta: number): string => {
	const [year, month] = ym.split("-").map(Number);
	const date = new Date(year, month - 1 + delta, 1);
	return toYearMonth(date);
};

/**
 * 日セルタップで確定する期間（設計書 (2/2) §4-5）。
 *
 * ローカルの 1 日を [00:00:00.000, 23:59:59.999] の ISO8601 で表す。
 * `QueryMyDishesDto` の `from` / `to` はどちらも ISO8601 なので、そのまま渡せる。
 */
export const toDayRange = (dateKey: string): { from: string; to: string } => {
	const [year, month, day] = dateKey.split("-").map(Number);
	return {
		from: new Date(year, month - 1, day, 0, 0, 0, 0).toISOString(),
		to: new Date(year, month - 1, day, 23, 59, 59, 999).toISOString(),
	};
};

/**
 * 日セルのサムネイル URL。
 *
 * #1398 PR5 でロジック本体を `thumbnail.ts` の `resolveMyDishThumbnailUrl` へ切り出し、
 * list ビューと共有した。ここでは Calendar からの既存の呼び出し名を変えないための re-export
 * （挙動・テストは変えていない）。
 */
export const resolveDayThumbnailUrl = resolveMyDishThumbnailUrl;

/** 月グリッドのセル（先頭の空白 + 1..末日 + 末尾の空白）を組む */
const buildMonthCells = (ym: string, itemsByDate: Map<string, MyDishItem[]>): CalendarMonth => {
	const [year, month] = ym.split("-").map(Number);
	const leading = (new Date(year, month - 1, 1).getDay() - CALENDAR_WEEK_START + 7) % 7;
	// 「翌月の 0 日」= 当月の末日
	const daysInMonth = new Date(year, month, 0).getDate();

	const cells: (CalendarDayCell | null)[] = [];
	for (let i = 0; i < leading; i += 1) cells.push(null);

	let itemCount = 0;
	for (let day = 1; day <= daysInMonth; day += 1) {
		const dateKey = `${ym}-${pad2(day)}`;
		const items = itemsByDate.get(dateKey) ?? [];
		itemCount += items.length;
		cells.push({ dateKey, day, items });
	}

	while (cells.length % 7 !== 0) cells.push(null);

	return { ym, year, month, cells, itemCount };
};

export type BuildCalendarMonthsParams = {
	/** 取得済みの行（`useMyDishesQuery` の `items`。並び順はクエリの `sort` のまま） */
	items: MyDishItem[];
	/** 画面を開いている「今月」（`YYYY-MM`）。最新月の下限に使う */
	nowYm: string;
	/** `meta.oldestOccurredAt`（#1395 §4-4）。null なら終端不明 */
	oldestOccurredAt: string | null;
	/**
	 * 前回の結果（独立レビュー指摘: 月単位の再利用）。中身が変わっていない月は
	 * **前回のオブジェクトをそのまま返す**ことで、`DayCell` の memo（参照比較）を効かせる。
	 * これが無いと行が 1 件増えるだけで全月・全セルが作り直され、memo が一度も効かない
	 */
	previousMonths?: CalendarMonth[];
};

/** 月の中身の同一性判定に使う署名。日付ごとの item.key の並びが同じなら同じ月 */
/**
 * 2 つの月グリッドが «同じ中身» か。同じなら前回のオブジェクトを使い回して
 * `MonthGrid` / `DayCell` の memo を効かせる。
 *
 * #1375（5 巡目・性能レビュー B-3）以前はここで両方の月を 1 本の署名文字列へ畳んで
 * 比較していた。1 か月 = 42 セル、月は最大 `MAX_CALENDAR_MONTHS` 本あるので、
 * **`items` が 1 件増えるたびに «全月ぶんの署名文字列» を 2 セット作り直していた**
 * （しかも 99% の月は «同じ» と分かるだけのために捨てられる）。
 * 走査して違いが出た時点で抜ければ、文字列を 1 つも作らずに同じ判定ができる。
 */
const isSameMonthCells = (a: CalendarMonth, b: CalendarMonth): boolean => {
	if (a.cells.length !== b.cells.length) return false;
	for (let i = 0; i < a.cells.length; i++) {
		const cellA = a.cells[i];
		const cellB = b.cells[i];
		if (cellA === null || cellB === null) {
			if (cellA !== cellB) return false;
			continue;
		}
		if (cellA.day !== cellB.day) return false;
		if (cellA.items.length !== cellB.items.length) return false;
		for (let j = 0; j < cellA.items.length; j++) {
			if (cellA.items[j].key !== cellB.items[j].key) return false;
		}
	}
	return true;
};

/**
 * 月グリッドを**新しい順**（inverted FlatList の `data[0]` = 画面下端 = 最新月）で返す。
 *
 * - 記録が 0 件の月も描く。描かないと 8 月の次が 3 月になり、カレンダーとして破綻する（§4-3）。
 * - 生成範囲は `newestYm`（今月と最新記録月の新しいほう）から
 *   `floorYm`（読み込み済みの最古の月。ただし `oldestOccurredAt` より古くしない）まで。
 */
export const buildCalendarMonths = ({
	items,
	nowYm,
	oldestOccurredAt,
	previousMonths,
}: BuildCalendarMonthsParams): CalendarMonth[] => {
	const itemsByDate = new Map<string, MyDishItem[]>();
	let oldestItemYm: string | null = null;
	let newestItemYm: string | null = null;

	for (const item of items) {
		const dateKey = isoToLocalDateKey(item?.occurredAt);
		if (!dateKey) continue;
		const bucket = itemsByDate.get(dateKey);
		if (bucket) bucket.push(item);
		else itemsByDate.set(dateKey, [item]);

		const ym = dateKey.slice(0, 7);
		if (oldestItemYm === null || ym < oldestItemYm) oldestItemYm = ym;
		if (newestItemYm === null || ym > newestItemYm) newestItemYm = ym;
	}

	const newestYm = newestItemYm !== null && newestItemYm > nowYm ? newestItemYm : nowYm;

	// 今月は必ず描く（最新の記録が未来日でも、今月まではカレンダーとして繋がっている必要がある）
	let floorYm = oldestItemYm !== null && oldestItemYm < nowYm ? oldestItemYm : nowYm;

	// #1396 【設計】`oldestOccurredAt` は遡りの終端。これより古い月は 1 つも作らない（§4-4）。
	// ただし終端が今月より新しくても今月は落とさない
	//
	// #1396 PR5 レビュー m-3: サーバの終端と実データが食い違い、`oldestOccurredAt` より古い行が
	// 実際に読み込まれているときは、その月を**切り捨てず終端のほうを伸ばす**。
	// 切り捨てると記録が UI から黙って消える（消える > 余分な空月が出る、の順で危険）ため。
	const oldestBoundYm = isoToYearMonth(oldestOccurredAt);
	if (oldestBoundYm !== null && floorYm < oldestBoundYm) {
		const boundYm = oldestBoundYm > nowYm ? nowYm : oldestBoundYm;
		floorYm = oldestItemYm !== null && oldestItemYm < boundYm ? oldestItemYm : boundYm;
	}
	if (floorYm > newestYm) floorYm = newestYm;

	const previousByYm = new Map((previousMonths ?? []).map((month) => [month.ym, month]));

	const months: CalendarMonth[] = [];
	let cursorYm = newestYm;
	while (cursorYm >= floorYm && months.length < MAX_CALENDAR_MONTHS) {
		const built = buildMonthCells(cursorYm, itemsByDate);
		const previous = previousByYm.get(cursorYm);
		// 中身が同じ月は前回のオブジェクトを返す（DayCell の memo を効かせるため）
		months.push(previous !== undefined && isSameMonthCells(previous, built) ? previous : built);
		cursorYm = addMonths(cursorYm, -1);
	}
	return months;
};

/**
 * これ以上「上（過去）」へ伸ばせるか。
 *
 * ⚠️ 正の終了条件は `nextCursor === null`（= `hasNextPage === false`）**だけ**である（§4-4）。
 * `oldestOccurredAt` は「終端がどこか」を UI に出すための補助でしかなく、
 * これを終了条件に使うと、42 件が同じ月に収まったページの直後に誤って打ち切ってしまう。
 *
 * ## ⚠️ `error === null` を必ず条件へ入れること（#1439 B-1 / #1446 B-1。同じバグ型の 3 回目）
 *
 * `onEndReached` の再発火条件は「**contentLength が前回発火時と違うこと**」であり、
 * スクロールだけでなく `_onContentSizeChange` / `_onLayout` からも判定が走る
 * （`react-native-web/dist/vendor/react-native/VirtualizedList/index.js:1351` /
 * `@react-native/virtualized-lists/Lists/VirtualizedList.js:1582-1587`）。
 * 一方 `fetchMore`（`stores/useMyDishesStore.ts`）は冒頭で `errorByQuery` を null に戻すので、
 * `error` を見ないと「失敗 → フッタの高さが変わる → 再発火 → 再送 → 失敗」で
 * **ユーザーが指一本動かさないまま 964MB の `dish_reviews` を叩き続ける**。
 *
 * エラー中の再取得の入口は**フッタの再試行ボタン押下だけ**にする。
 */
export const canLoadOlderMonths = (params: {
	hasNextPage: boolean;
	isLoadingMore: boolean;
	error: string | null;
}): boolean => params.hasNextPage && !params.isLoadingMore && params.error === null;

/**
 * 直前の `loadMore` の結果を見て、次の `onEndReached` を握り潰すか（#1446 M-1）。
 *
 * Calendar は**コンテンツ高（月グリッド数）と件数が切り離されている**唯一のビューである。
 * 42 件が全部同じ月に収まると、1 ページ読んでも月が 1 つも増えず contentLength が変わらない
 * ……はずだが、フッタが「スピナー（高さあり）↔ null（高さ 0）」で往復すると contentLength が
 * `L → L+S → L` と往復し、`contentLength !== _sentEndForContentLength` が成立し続ける。
 * その結果、指を離したまま次ページ・また次ページと自動で読み続ける
 * （= 設計書 §4-4 / 確定事項2 が名指しで警告したケース）。
 *
 * 対処は 2 つ入れてある。
 * 1. フッタの高さを状態に依らず一定にする（`MyDishesCalendarView` の `styles.footer`）
 * 2. **直前の `loadMore` で月が 1 つも増えなかったら、次の 1 回を無視する**（この関数）
 *
 * `isLoadingMore` は同時実行を 1 本に絞るだけで、**逐次の連投は止めない**ことに注意。
 *
 * @param monthCountAtLastLoad 直前に `loadMore` を投げた時点の月数。まだ投げていなければ null
 * @param monthCount 現在の月数
 */
export const shouldIgnoreEndReached = (params: { monthCountAtLastLoad: number | null; monthCount: number }): boolean =>
	params.monthCountAtLastLoad !== null && params.monthCount <= params.monthCountAtLastLoad;

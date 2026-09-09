/*
#1396 PR5 Calendar の純ロジック（`features/myDishes/calendar.ts`）。

固定したいのは 3 点：
1. バケットの基準は `occurredAt`（`savedAt` / `eatenAt` ではない）で、端末のローカル TZ で日へ落とす
2. `meta.oldestOccurredAt` より古い月を生成しない（inverted リストが上へ伸び続けないための終端）
3. `dishMedia === null` でも灰色プレースホルダーにせず、`categoryImageUrl` → `restaurant.image_url` を使う

⚠️ ローカル TZ 依存を避けるため、テストデータの `occurredAt` は
「ローカルの正午」から作る（`new Date(y, m, d, 12).toISOString()`）。
どの TZ で走らせても同じローカル日付に落ちる。
*/
import type { MyDishItem } from "@shared/api/v1/res";
import {
	MAX_CALENDAR_MONTHS,
	addMonths,
	buildCalendarMonths,
	canLoadOlderMonths,
	isoToLocalDateKey,
	isoToYearMonth,
	resolveDayThumbnailUrl,
	shouldIgnoreEndReached,
	toDayRange,
	toYearMonth,
} from "./calendar";

/** ローカルの `y-m-d 12:00` を ISO8601（UTC）で返す。TZ に依らず同じローカル日付になる */
const localNoonIso = (year: number, month: number, day: number): string =>
	new Date(year, month - 1, day, 12, 0, 0, 0).toISOString();

const makeItem = (
	overrides: {
		key?: string;
		occurredAt?: string;
		thumbnailImageUrl?: string | null;
		categoryImageUrl?: string | null;
		restaurantImageUrl?: string | null;
	} = {},
): MyDishItem =>
	({
		key: overrides.key ?? "review:1",
		status: "eaten",
		occurredAt: overrides.occurredAt ?? localNoonIso(2026, 8, 10),
		savedAt: null,
		eatenAt: overrides.occurredAt ?? localNoonIso(2026, 8, 10),
		restaurant: {
			id: "restaurant-1",
			name: "テスト食堂",
			// ⚠️ #1779 `image_url` は **落とす列**。ここに値を入れたまま残すのは、
			//    «誤ってフォールバック先に戻したら赤くする» ためである（下のテスト参照）
			image_url: overrides.restaurantImageUrl ?? null,
			imageUrls: overrides.restaurantImageUrl ? { sm: overrides.restaurantImageUrl, md: overrides.restaurantImageUrl } : undefined,
		},
		dish: { id: "dish-1", name: "ラーメン", categoryImageUrl: overrides.categoryImageUrl ?? null },
		dishMedia:
			overrides.thumbnailImageUrl === undefined || overrides.thumbnailImageUrl === null
				? null
				: { id: "media-1", thumbnailImageUrl: overrides.thumbnailImageUrl },
		myReview: null,
	}) as unknown as MyDishItem;

const monthKeys = (months: { ym: string }[]): string[] => months.map((m) => m.ym);

describe("日付ユーティリティ", () => {
	it("ISO8601 をローカルタイムゾーンの YYYY-MM-DD / YYYY-MM に落とす", () => {
		const iso = localNoonIso(2026, 3, 5);
		expect(isoToLocalDateKey(iso)).toBe("2026-03-05");
		expect(isoToYearMonth(iso)).toBe("2026-03");
	});

	it("壊れた値・null では null を返す（1 行のせいで月グリッド全体を落とさない）", () => {
		expect(isoToLocalDateKey(null)).toBeNull();
		expect(isoToLocalDateKey(undefined)).toBeNull();
		expect(isoToLocalDateKey("not-a-date")).toBeNull();
		expect(isoToYearMonth("not-a-date")).toBeNull();
	});

	it("addMonths は年をまたいで正しく遡る", () => {
		expect(addMonths("2026-01", -1)).toBe("2025-12");
		expect(addMonths("2026-01", -13)).toBe("2024-12");
		expect(addMonths("2026-12", 1)).toBe("2027-01");
	});

	it("toYearMonth は 1 桁月を 0 埋めする（文字列比較で大小が正しくなる）", () => {
		expect(toYearMonth(new Date(2026, 0, 15))).toBe("2026-01");
		expect("2026-09" < "2026-10").toBe(true);
	});

	it("toDayRange はローカル 1 日を [00:00:00.000, 23:59:59.999] にする", () => {
		const { from, to } = toDayRange("2026-08-10");
		expect(from).toBe(new Date(2026, 7, 10, 0, 0, 0, 0).toISOString());
		expect(to).toBe(new Date(2026, 7, 10, 23, 59, 59, 999).toISOString());
		expect(new Date(to).getTime() - new Date(from).getTime()).toBe(24 * 60 * 60 * 1000 - 1);
	});
});

describe("resolveDayThumbnailUrl（#1375 追補2 決定3）", () => {
	it("dishMedia があればそのサムネイルを使う", () => {
		const item = makeItem({
			thumbnailImageUrl: "https://example.com/media.jpg",
			categoryImageUrl: "https://example.com/category.jpg",
			restaurantImageUrl: "https://example.com/restaurant.jpg",
		});
		expect(resolveDayThumbnailUrl(item)).toBe("https://example.com/media.jpg");
	});

	it("dishMedia === null なら dish.categoryImageUrl へ落ちる（灰色プレースホルダーにしない）", () => {
		const item = makeItem({
			thumbnailImageUrl: null,
			categoryImageUrl: "https://example.com/category.jpg",
			restaurantImageUrl: "https://example.com/restaurant.jpg",
		});
		expect(item.dishMedia).toBeNull();
		expect(resolveDayThumbnailUrl(item)).toBe("https://example.com/category.jpg");
	});

	it("categoryImageUrl も無ければ restaurant.imageUrls?.sm へ落ちる", () => {
		const item = makeItem({
			thumbnailImageUrl: null,
			categoryImageUrl: null,
			restaurantImageUrl: "https://example.com/restaurant.jpg",
		});
		expect(resolveDayThumbnailUrl(item)).toBe("https://example.com/restaurant.jpg");
	});

	it("どれも無ければ null（このときだけ日番号だけのセルになる）", () => {
		expect(resolveDayThumbnailUrl(makeItem({ thumbnailImageUrl: null, categoryImageUrl: null }))).toBeNull();
	});
});

describe("buildCalendarMonths", () => {
	it("新しい順（inverted の data[0] = 画面下端 = 最新月）で返す", () => {
		const months = buildCalendarMonths({
			items: [makeItem({ key: "a", occurredAt: localNoonIso(2026, 6, 1) })],
			nowYm: "2026-08",
			oldestOccurredAt: null,
		});
		expect(monthKeys(months)).toEqual(["2026-08", "2026-07", "2026-06"]);
	});

	it("記録が 0 件の月も月グリッドを描く（8 月の次が 3 月にならない）", () => {
		const months = buildCalendarMonths({
			items: [
				makeItem({ key: "a", occurredAt: localNoonIso(2026, 8, 2) }),
				makeItem({ key: "b", occurredAt: localNoonIso(2026, 3, 20) }),
			],
			nowYm: "2026-08",
			oldestOccurredAt: null,
		});
		expect(monthKeys(months)).toEqual(["2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03"]);
		expect(months.find((m) => m.ym === "2026-05")?.itemCount).toBe(0);
		expect(months.find((m) => m.ym === "2026-03")?.itemCount).toBe(1);
	});

	it("occurredAt でバケットする（savedAt / eatenAt には引っ張られない）", () => {
		const item = makeItem({ key: "a", occurredAt: localNoonIso(2026, 8, 10) });
		// want 行では occurredAt と savedAt が食い違うことがある（MyDishItem の docstring）
		(item as { savedAt: string | null }).savedAt = localNoonIso(2026, 1, 1);
		const months = buildCalendarMonths({ items: [item], nowYm: "2026-08", oldestOccurredAt: null });

		expect(monthKeys(months)).toEqual(["2026-08"]);
		const august = months[0];
		expect(august.cells.find((c) => c?.dateKey === "2026-08-10")?.items).toHaveLength(1);
		expect(august.cells.find((c) => c?.dateKey === "2026-01-01")).toBeUndefined();
	});

	it("同じ日の複数件は 1 つのセルに束ね、先頭が代表になる", () => {
		const months = buildCalendarMonths({
			items: [
				makeItem({ key: "a", occurredAt: localNoonIso(2026, 8, 10) }),
				makeItem({ key: "b", occurredAt: localNoonIso(2026, 8, 10) }),
			],
			nowYm: "2026-08",
			oldestOccurredAt: null,
		});
		const cell = months[0].cells.find((c) => c?.dateKey === "2026-08-10");
		expect(cell?.items.map((i) => i.key)).toEqual(["a", "b"]);
	});

	it("月グリッドは 7 の倍数のセルを持ち、1 日が正しい曜日から始まる", () => {
		const months = buildCalendarMonths({ items: [], nowYm: "2026-08", oldestOccurredAt: null });
		const august = months[0];
		expect(august.cells.length % 7).toBe(0);
		// 2026-08-01 は土曜（getDay() === 6）なので、先頭に 6 個の空白が入る
		expect(new Date(2026, 7, 1).getDay()).toBe(6);
		expect(august.cells.slice(0, 6).every((c) => c === null)).toBe(true);
		expect(august.cells[6]?.day).toBe(1);
		// 8 月は 31 日
		expect(august.cells.filter((c) => c !== null)).toHaveLength(31);
	});

	it("記録が 1 件も無くても今月だけは描く", () => {
		const months = buildCalendarMonths({ items: [], nowYm: "2026-08", oldestOccurredAt: null });
		expect(monthKeys(months)).toEqual(["2026-08"]);
	});

	it("未来日の記録があれば、その月まで伸ばす（今月より新しい月を落とさない）", () => {
		const months = buildCalendarMonths({
			items: [makeItem({ key: "a", occurredAt: localNoonIso(2026, 10, 1) })],
			nowYm: "2026-08",
			oldestOccurredAt: null,
		});
		expect(monthKeys(months)).toEqual(["2026-10", "2026-09", "2026-08"]);
	});

	it("壊れた occurredAt の行は無視するが、他の行の月は残る", () => {
		const broken = makeItem({ key: "broken" });
		(broken as { occurredAt: string }).occurredAt = "not-a-date";
		const months = buildCalendarMonths({
			items: [broken, makeItem({ key: "a", occurredAt: localNoonIso(2026, 7, 3) })],
			nowYm: "2026-08",
			oldestOccurredAt: null,
		});
		expect(monthKeys(months)).toEqual(["2026-08", "2026-07"]);
	});

	describe("meta.oldestOccurredAt を遡りの終端として使う（§4-4）", () => {
		it("読み込んだ行が oldestOccurredAt より古いときは、切り捨てずに終端のほうを伸ばす（#1446 m-3）", () => {
			// サーバの終端（2026-05）と実データ（2020-01 の行）が食い違うケース。
			// ⚠️ 旧仕様は 2026-05 で切って 2020-01 の記録を**黙って消して**いた。
			// 記録が UI から消えるより、余分な空月が並ぶほうが安全側なので終端を伸ばす
			const months = buildCalendarMonths({
				items: [
					makeItem({ key: "a", occurredAt: localNoonIso(2026, 8, 1) }),
					makeItem({ key: "old", occurredAt: localNoonIso(2020, 1, 5) }),
				],
				nowYm: "2026-08",
				oldestOccurredAt: localNoonIso(2026, 5, 1),
			});
			expect(monthKeys(months)[0]).toBe("2026-08");
			expect(monthKeys(months)[months.length - 1]).toBe("2020-01");
			// 実際に行がある月が UI から消えていないこと（これが本命のアサーション）
			const january2020 = months.find((m) => m.ym === "2020-01");
			expect(january2020?.itemCount).toBe(1);
		});

		it("終端より古い行が無ければ、oldestOccurredAt より古い月は生成しない", () => {
			const months = buildCalendarMonths({
				items: [
					makeItem({ key: "a", occurredAt: localNoonIso(2026, 8, 1) }),
					makeItem({ key: "b", occurredAt: localNoonIso(2026, 6, 5) }),
				],
				nowYm: "2026-08",
				oldestOccurredAt: localNoonIso(2026, 5, 1),
			});
			expect(monthKeys(months)).toEqual(["2026-08", "2026-07", "2026-06"]);
			expect(months.some((m) => m.ym < "2026-06")).toBe(false);
		});

		it("oldestOccurredAt が null なら、読み込み済みの最古の月で止まる（無限に生成しない）", () => {
			const months = buildCalendarMonths({
				items: [makeItem({ key: "a", occurredAt: localNoonIso(2026, 7, 1) })],
				nowYm: "2026-08",
				oldestOccurredAt: null,
			});
			expect(monthKeys(months)).toEqual(["2026-08", "2026-07"]);
		});

		it("oldestOccurredAt が読み込み済みより古くても、まだ読んでいない月は先に描かない", () => {
			// 終端は 2020-01 だが 1 ページ目は 2026-07 までしか読んでいない。
			// ここで 2020-01 まで空の月を生やすと「データがあるのに空」の月が大量に並ぶ
			const months = buildCalendarMonths({
				items: [makeItem({ key: "a", occurredAt: localNoonIso(2026, 7, 1) })],
				nowYm: "2026-08",
				oldestOccurredAt: localNoonIso(2020, 1, 1),
			});
			expect(monthKeys(months)).toEqual(["2026-08", "2026-07"]);
		});

		it("生成月数には上限がある（暴走防止の最後の砦）", () => {
			const months = buildCalendarMonths({
				items: [makeItem({ key: "a", occurredAt: localNoonIso(1900, 1, 1) })],
				nowYm: "2026-08",
				oldestOccurredAt: null,
			});
			expect(months.length).toBe(MAX_CALENDAR_MONTHS);
		});
	});
});

describe("canLoadOlderMonths（§4-4: 終了条件は nextCursor === null だけ）", () => {
	it("次ページがあり、追加取得中でなく、エラーも無ければ読める", () => {
		expect(canLoadOlderMonths({ hasNextPage: true, isLoadingMore: false, error: null })).toBe(true);
	});

	it("終端（nextCursor === null）では読まない", () => {
		expect(canLoadOlderMonths({ hasNextPage: false, isLoadingMore: false, error: null })).toBe(false);
	});

	it("追加取得中は二重に投げない（42 件が同一月に収まっても連投しない）", () => {
		expect(canLoadOlderMonths({ hasNextPage: true, isLoadingMore: true, error: null })).toBe(false);
	});

	// ⚠️ #1439 B-1 / #1446 B-1 と同じバグ型（!error ガードの欠落による自動再取得ループ）の再発防止。
	// `onEndReached` は contentLength が変わるだけで再発火し、`fetchMore` は errorByQuery を
	// null に戻してから投げるため、ここで止めないと失敗のたびに即再送され続ける
	it("エラー中は onEndReached が来ても読まない（再取得の入口は再試行ボタンだけ）", () => {
		expect(canLoadOlderMonths({ hasNextPage: true, isLoadingMore: false, error: "boom" })).toBe(false);
	});
});

describe("shouldIgnoreEndReached（#1446 M-1: フッタ高の往復による自動連投を止める）", () => {
	it("まだ loadMore を投げていなければ無視しない", () => {
		expect(shouldIgnoreEndReached({ monthCountAtLastLoad: null, monthCount: 3 })).toBe(false);
	});

	it("直前の loadMore で月が増えていれば無視しない（ユーザーがさらに遡れる）", () => {
		expect(shouldIgnoreEndReached({ monthCountAtLastLoad: 3, monthCount: 5 })).toBe(false);
	});

	// 42 件が全部同じ月に収まったケース。月グリッドの高さは記録件数に依らず一定なので
	// contentLength が増えず、フッタ高の往復だけで onEndReached が再発火しうる
	it("直前の loadMore で月が 1 つも増えなかったら無視する", () => {
		expect(shouldIgnoreEndReached({ monthCountAtLastLoad: 3, monthCount: 3 })).toBe(true);
	});
});

/**
 * #1375（5 巡目・性能レビュー B-3）**変わっていない月は同じオブジェクトで返す。**
 *
 * `MonthGrid` / `DayCell` は memo なので、月オブジェクトの参照が変わらない限り再描画しない。
 * 行が 1 件増えるたびに全月を作り直して返すと、最大 `MAX_CALENDAR_MONTHS` 本の月グリッド
 * （1 月 = 42 セル）が丸ごと描き直され、カレンダーが目に見えて重くなる。
 *
 * 判定は署名文字列ではなく走査（`isSameMonthCells`）で行うようにした。
 * 文字列を作らないだけで結果は同じであることを、この 2 本が固定する。
 */
describe("buildCalendarMonths の previousMonths 再利用", () => {
	const build = (items: MyDishItem[], previousMonths?: ReturnType<typeof buildCalendarMonths>) =>
		buildCalendarMonths({ items, nowYm: "2026-08", oldestOccurredAt: null, previousMonths });

	it("中身が同じ月は前回と同じオブジェクトを返す", () => {
		const items = [makeItem({ key: "a", occurredAt: localNoonIso(2026, 6, 1) })];
		const first = build(items);
		const second = build(items, first);

		expect(second).toHaveLength(first.length);
		second.forEach((month, index) => expect(month).toBe(first[index]));
	});

	it("中身が変わった月だけ新しいオブジェクトになる（他の月は使い回す）", () => {
		const base = [makeItem({ key: "a", occurredAt: localNoonIso(2026, 6, 1) })];
		const first = build(base);
		const second = build([...base, makeItem({ key: "b", occurredAt: localNoonIso(2026, 7, 3) })], first);

		const byYm = (months: ReturnType<typeof buildCalendarMonths>, ym: string) =>
			months.find((month) => month.ym === ym);

		// 7 月に 1 件増えた → 7 月だけ作り直され、6 月・8 月は前回のまま
		expect(byYm(second, "2026-07")).not.toBe(byYm(first, "2026-07"));
		expect(byYm(second, "2026-06")).toBe(byYm(first, "2026-06"));
		expect(byYm(second, "2026-08")).toBe(byYm(first, "2026-08"));
	});
});

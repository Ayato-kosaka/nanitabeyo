/*
#1666 店舗詳細の «営業時間» 欄の不変条件を固定する。

| #1666 の完了条件 | ここで見ること |
| --- | --- |
| 出所・鮮度を含めて表示できる | 出所と取得日が描かれる |
| （受け入れ条件 4）データが無い店では欄ごと出さない | 何も描かない |

⚠️ **«行が無い曜日» は «定休» と描くこと。** «不明» にすると、絞り込み
（`resolveOpeningStatus`）が `closed` と判定する店を、詳細画面だけ «分からない» と
表示することになる。同じデータに 2 つの意味を持たせない。

⚠️ **«営業中» のバッジを描いてはいけない。** 判定は JST 固定で、dev には韓国にある店が
居る（#1881）。JST で «営業中» と書くとその店では嘘になる。

取得側（`useRestaurantOpeningHours`）は `restaurantOpeningHoursFetch.test.tsx` が見る。
このファイルは **渡された値をどう描くか**だけを見る。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

// i18n は «キー + 変数» をそのまま返す。文言そのものではなく «何を渡したか» を見たいため。
// ⚠️ `defaultValue` だけは **本物と同じに振る舞わせる**（i18n-js 4.5.1 は未知のキーで
//    `defaultValue` を返す）。ここを «ただの変数» として扱うと、«未知の出所が来たときに
//    素の名前へ落ちる» という本番の振る舞いをテストできない。
jest.mock("@/lib/i18n", () => {
	const KNOWN_SOURCES = ["osm", "official_site", "user", "owner"];
	return {
		__esModule: true,
		default: {
			t: (key: string, params?: Record<string, unknown>) => {
				if (key.startsWith("Restaurant.detail.openingHours.sources.")) {
					const source = key.slice("Restaurant.detail.openingHours.sources.".length);
					return KNOWN_SOURCES.includes(source) ? key : String(params?.defaultValue ?? key);
				}
				const rest = Object.entries(params ?? {}).filter(([k]) => k !== "defaultValue");
				return rest.length > 0 ? `${key}(${rest.map(([k, v]) => `${k}=${String(v)}`).join(",")})` : key;
			},
		},
	};
});
jest.mock("@/contexts/ThemeProvider", () => ({
	useThemedStyles: (factory: (colors: Record<string, string>) => unknown) => factory({} as never),
	useAppTheme: () => ({ colors: {} }),
}));
jest.mock("lucide-react-native", () => ({ Clock: () => null }));

import { RestaurantOpeningHours } from "@/features/restaurant/components/RestaurantOpeningHours";
import type { GetRestaurantOpeningHoursResponse } from "@shared/api/v1/res";

type Hours = GetRestaurantOpeningHoursResponse;
type Span = Hours["days"][number]["spans"][number];

const render = async (hours: Hours | null) => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<RestaurantOpeningHours hours={hours} />);
	});
	return tree;
};

/** 描かれている文字列を全部集める（どの Text に入っているかは問わない） */
const texts = (tree: TestRenderer.ReactTestRenderer): string[] =>
	tree.root
		.findAll((n) => (n.type as unknown as string) === "Text")
		.flatMap((n) => n.children.filter((c): c is string => typeof c === "string"));

const week = (
	spansByDow: Record<number, Span[]>,
	overrides: Partial<Hours> = {},
): Hours => ({
	days: Array.from({ length: 7 }, (_, dayOfWeek) => ({
		dayOfWeek,
		spans: spansByDow[dayOfWeek] ?? [],
	})),
	sources: ["osm"],
	fetchedAt: "2026-09-06T13:25:55.000Z",
	...overrides,
});

const span = (opensAt: string, closesAt: string, crossesMidnight = false): Span => ({
	opensAt,
	closesAt,
	crossesMidnight,
});

describe("#1666 店舗詳細の営業時間", () => {
	it("まだ取れていない（null）ときは、欄ごと出さない", async () => {
		const tree = await render(null);
		expect(tree.root.findAllByProps({ testID: "restaurant-opening-hours" })).toHaveLength(0);
	});

	it("営業時間が 1 件も無い店では、欄ごと出さない（「情報なし」とも書かない）", async () => {
		const tree = await render({ days: [], sources: [], fetchedAt: null });
		expect(tree.root.findAllByProps({ testID: "restaurant-opening-hours" })).toHaveLength(0);
		expect(texts(tree)).toEqual([]);
	});

	it("想定外の応答が来ても、店舗詳細ごと落ちない", async () => {
		/*
		⚠️ 実際にこれで落とした。`hours.days.length` だけを見ていたので、
		   `days` を持たない応答（この API を持たない古い API の 404 本文など）で
		   `Cannot read properties of undefined` になり、**店の画面が開けなくなった**。
		   営業時間は «あれば出す» 情報で、これが原因で画面が死ぬのは割に合わない。
		*/
		const tree = await render({ some: "unexpected" } as unknown as Hours);
		expect(tree.root.findAllByProps({ testID: "restaurant-opening-hours" })).toHaveLength(0);
	});

	it("行の無い曜日は «定休» と描く（«不明» にしない）", async () => {
		const tree = await render(week({ 1: [span("11:00", "14:00")] }));
		const rendered = texts(tree);
		expect(rendered).toContain("11:00–14:00");
		expect(rendered.filter((t) => t === "Restaurant.detail.openingHours.closed")).toHaveLength(6);
	});

	it("日またぎのコマは閉店側に «翌» を付ける（付けないと 8 時間営業に見える）", async () => {
		const tree = await render(week({ 5: [span("18:00", "02:00", true)] }));
		expect(texts(tree)).toContain("18:00–Restaurant.detail.openingHours.nextDay(time=02:00)");
	});

	it("1 日に複数コマがあれば全部出す", async () => {
		const tree = await render(week({ 3: [span("11:00", "14:00"), span("17:00", "21:00")] }));
		expect(texts(tree)).toContain("11:00–14:00  17:00–21:00");
	});

	it("週は日曜始まり（カレンダーと同じ並び）で 7 行", async () => {
		/*
		⚠️ 曜日の並びはカレンダー（`CALENDAR_WEEKDAY_KEYS` / 週の始まりは日曜固定）と
		   同じものを使っている。ここで独自に月曜始まりにすると、同じアプリの中で
		   週の始まりが 2 種類になる。
		*/
		const tree = await render(week({ 0: [span("10:00", "18:00")] }));
		for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
			expect(
				tree.root.findAllByProps({ testID: `restaurant-opening-hours-day-${dayOfWeek}` }).length,
			).toBeGreaterThan(0);
		}
		expect(texts(tree)[1]).toBe("MyDishes.calendar.weekdays.sun");
	});

	it("出所と取得日を添える（完了条件「出所・鮮度を含めて表示できる」）", async () => {
		const tree = await render(
			week({ 1: [span("09:00", "18:00")] }, { sources: ["official_site", "osm"] }),
		);
		const provenance = tree.root.findByProps({ testID: "restaurant-opening-hours-provenance" });
		expect(provenance.props.children).toBe(
			"Restaurant.detail.openingHours.provenance(" +
				"sources=Restaurant.detail.openingHours.sources.official_site / " +
				"Restaurant.detail.openingHours.sources.osm,date=2026-09-06)",
		);
	});

	it("知らない出所が来たら、素の名前をそのまま出す（«[missing …]» を画面に出さない）", async () => {
		const tree = await render(
			week({ 1: [span("09:00", "18:00")] }, { sources: ["some_new_source"] }),
		);
		const provenance = tree.root.findByProps({ testID: "restaurant-opening-hours-provenance" });
		expect(provenance.props.children).toContain("sources=some_new_source");
	});
});

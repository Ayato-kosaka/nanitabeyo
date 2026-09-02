/*
#1446 レビュワー提案: **UTC で月をまたぐ時刻**（例: `2026-09-01T00:30:00Z` を UTC-7 で見ると 8 月）の回帰を止める。

`calendar.test.ts` は TZ 非依存にするため「ローカルの正午」から ISO を作っており、その作りでは
「UTC とローカルで月が違う」瞬間を 1 度も通らない。ここだけ **端末を UTC-7 に見せかけて**、
`occurredAt` のバケットが UTC ではなく端末ローカルの月へ入ることを固定する（#1395 §6）。

## なぜ `process.env.TZ` を書き換えないのか（実測）

jest のテスト環境は `process.env` を **サンドボックス内のコピー**として持つため、
`process.env.TZ = "America/Los_Angeles"` を代入しても Node の `tzset()` が呼ばれず、
`new Date(...)` のローカル解釈は UTC のまま変わらない（この環境で実測。CI も TZ=UTC）。
`jest.setup.js` や実行コマンドで TZ を固定する手もあるが、それは全 800+ テストの前提を
変える話になるので採らない。

## 代わりにやっていること

`calendar.ts` がローカル時刻へ触る経路は 2 つしかない。

1. `Date` の **ローカル getter**（`getFullYear` / `getMonth` / `getDate` / `getDay`）
2. `new Date(year, monthIndex, day, ...)` の **ローカル解釈のコンストラクタ**（`toDayRange`）

この 2 つだけを UTC-7 に差し替えた `Date` をグローバルへ挿す。`getTime()` / `toISOString()` /
ISO 文字列のパースは素の `Date` のまま（= UTC 基準）なので、実際の TZ 環境と同じ関係になる。

⚠️ グローバルの `Date` を差し替えるため、**このファイルを他のテストと混ぜない**
（jest はファイルごとにグローバルを分けるので、独立した spec に切ってある）。
*/
import type { MyDishItem } from "@shared/api/v1/res";
import { buildCalendarMonths, isoToLocalDateKey, isoToYearMonth, toDayRange } from "./calendar";

/** 見せかけるローカルオフセット。UTC-7（America/Los_Angeles の夏時間）。local = utc - 7h */
const OFFSET_MS = -7 * 60 * 60 * 1000;

const RealDate = Date;

/** ローカル時刻を UTC-7 として解釈／表示する `Date`。UTC 系の API は素のまま */
class FakeLocalDate extends RealDate {
	constructor(...args: unknown[]) {
		if (args.length >= 2) {
			// `new Date(y, monthIndex, d, h, mi, s, ms)`（ローカル解釈）。
			// ローカル → UTC は「オフセットを引く」。UTC-7 なら 7 時間足すことになる
			const [y, mo, d = 1, h = 0, mi = 0, sec = 0, ms = 0] = args as number[];
			super(RealDate.UTC(y, mo, d, h, mi, sec, ms) - OFFSET_MS);
		} else if (args.length === 1) {
			super(args[0] as string | number | Date);
		} else {
			super();
		}
	}

	/** ローカル getter が見る「ずらした瞬間」 */
	private shifted(): Date {
		return new RealDate(this.getTime() + OFFSET_MS);
	}

	override getFullYear(): number {
		return this.shifted().getUTCFullYear();
	}
	override getMonth(): number {
		return this.shifted().getUTCMonth();
	}
	override getDate(): number {
		return this.shifted().getUTCDate();
	}
	override getDay(): number {
		return this.shifted().getUTCDay();
	}
	override getHours(): number {
		return this.shifted().getUTCHours();
	}
	override getTimezoneOffset(): number {
		return -OFFSET_MS / 60000;
	}
}

const makeItem = (key: string, occurredAt: string): MyDishItem =>
	({
		key,
		status: "eaten",
		occurredAt,
		savedAt: null,
		eatenAt: occurredAt,
		restaurant: { id: "restaurant-1", name: "テスト食堂", image_url: null },
		dish: { id: "dish-1", name: "ラーメン", categoryImageUrl: null },
		dishMedia: null,
		myReview: null,
	}) as unknown as MyDishItem;

beforeAll(() => {
	(globalThis as { Date: DateConstructor }).Date = FakeLocalDate as unknown as DateConstructor;
});

afterAll(() => {
	(globalThis as { Date: DateConstructor }).Date = RealDate;
});

describe("#1446 UTC とローカルで月をまたぐ時刻（端末を UTC-7 に見せかける）", () => {
	it("見せかけが効いている（前提の確認。効いていないとこの spec は無意味になる）", () => {
		// 2026-09-01T00:30:00Z は UTC-7 で見ると 8/31 17:30
		expect(new Date("2026-09-01T00:30:00Z").getMonth()).toBe(7);
		expect(new Date("2026-09-01T00:30:00Z").getDate()).toBe(31);
		// UTC 系の API は素のまま（= 実際の TZ 環境と同じ関係）
		expect(new Date("2026-09-01T00:30:00Z").toISOString()).toBe("2026-09-01T00:30:00.000Z");
	});

	it("バケットは UTC ではなく端末ローカルの日 / 月へ入る（#1395 §6）", () => {
		expect(isoToLocalDateKey("2026-09-01T00:30:00Z")).toBe("2026-08-31");
		expect(isoToYearMonth("2026-09-01T00:30:00Z")).toBe("2026-08");
	});

	it("UTC で 9 月の行がローカル 8 月のグリッドへ入り、9 月のグリッドは空になる", () => {
		const months = buildCalendarMonths({
			items: [makeItem("cross", "2026-09-01T00:30:00Z")],
			nowYm: "2026-09",
			oldestOccurredAt: null,
		});

		expect(months.map((m) => m.ym)).toEqual(["2026-09", "2026-08"]);
		expect(months.find((m) => m.ym === "2026-09")?.itemCount).toBe(0);

		const august = months.find((m) => m.ym === "2026-08");
		expect(august?.itemCount).toBe(1);
		// 8/31 のセルに入っていること（= カレンダー上で見えている日と中身が一致する）
		expect(august?.cells.find((cell) => cell?.dateKey === "2026-08-31")?.items).toHaveLength(1);
	});

	it("月末の終端（oldestOccurredAt）もローカル基準で判定される", () => {
		// 終端が UTC で 9/1 でも、ローカルでは 8 月なので 8 月まで描ける
		const months = buildCalendarMonths({
			items: [makeItem("cross", "2026-09-01T00:30:00Z")],
			nowYm: "2026-09",
			oldestOccurredAt: "2026-09-01T00:30:00Z",
		});
		expect(months.map((m) => m.ym)).toEqual(["2026-09", "2026-08"]);
	});

	it("日セルタップの from / to もローカル基準なので、見えている日と取得範囲が食い違わない", () => {
		const { from, to } = toDayRange("2026-08-31");

		// ローカル 8/31 00:00 = UTC 8/31 07:00 / ローカル 8/31 23:59:59.999 = UTC 9/1 06:59:59.999
		expect(from).toBe("2026-08-31T07:00:00.000Z");
		expect(to).toBe("2026-09-01T06:59:59.999Z");

		// ★ 本命: 8/31 のセルに見えている行（UTC 9/1 00:30）が、その範囲にちゃんと入る。
		// ここがずれると「押したのに 0 件」になる
		const crossing = new RealDate("2026-09-01T00:30:00Z").getTime();
		expect(crossing).toBeGreaterThan(new RealDate(from).getTime());
		expect(crossing).toBeLessThan(new RealDate(to).getTime());
	});
});

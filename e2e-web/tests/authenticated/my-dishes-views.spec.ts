import type { Page, Route } from "@playwright/test";
import { test, expect } from "../../fixtures/test";
import { MyDishesPage } from "../../pages/MyDishesPage";
import { loadTestUserCredentials } from "../../utils/testUserSession";

/**
 * 🍽 #1403 (PR1) my-dishes の 3 ビュー切替と、**フィルタが 3 ビューで共有される**ことの証跡
 *
 * ## この spec が固定する完了条件（#1403 「タブ切替と 3 ビュー」）
 *
 * 1. list / Map / Calendar を切り替えられる（1 ルート + `?view=` / #1396 §2-2）
 * 2. **ビュー切替では取り直さない**（同じ `queryKey` を 3 ビューが共有する / §3-3）
 * 3. 一度訪問したビューはアンマウントされない（keep-alive / M-1）
 * 4. フィルタを 1 回適用すると **list / Map / Calendar の 3 つすべて**が同じ絞り込みになる
 *
 * ## なぜ web だけで «件数まで» 見るのか（#1403 の書き分け基準）
 *
 * 4 を «棚が何件に減ったか» で確かめるには「フィルタ前は 2 件・後は 1 件」という前提を
 * 固定しなければならない。dev DB のテストユーザーの記録は件数も日付も店舗も変動するので、
 * 実データでは固定できない。`route.fulfill` が使える web へ寄せ、**ネイティブ側は
 * 「切替」と「フィルタ選択がビューをまたいで保持されること」までに留める**
 *（e2e-mobile/tests/authenticated/my-dishes-views.test.ts。Detox にはネットワーク傍受も
 *  レスポンス差し替えも無い）。
 *
 * ⚠️ ついでに、これは **`api-development` の未デプロイ（`GET /v1/users/me/dishes` が 404）に
 * 引きずられない**という利点もある。この spec が見ているのは「共有フィルタが 3 ビューの
 * クエリと描画へ伝播するか」というクライアント側の不変条件で、API の中身ではない。
 *
 * ## Map だけ «クエリ» で見る理由
 *
 * web の Map は `@react-google-maps/api`（`components/MapView.web.tsx`）で、ピンは
 * Google Maps JS の読み込み完了後の `OverlayView` として描かれる。CI から外部の
 * Maps JS が引けるかどうかに検証が引きずられるので、Map については
 * **`v1/users/me/dishes/map-pins` のクエリに同じ絞り込みが乗ったか**で判定する。
 * ピンそのものの描画・タップは #1397 の spec が受け持つ。
 *
 * ⚠️ `route.fulfill()` の封筒は **`{ success, data }`**（`BaseResponse`）。`useAPICall` は
 * `json.data` だけを取り出すので、外せば画面はエラー表示になる
 *（tests/authenticated/my-dishes-calendar.spec.ts に同じ注意書きがある）。
 *
 * ## Tier
 * Tier 2（無タグ）。`desktop-chrome-authenticated` のみ。取得を 2 本ともモックで止めるので
 * dev DB へは読み書きとも一切行かない（= `@mutation` ではない）。
 */
const credentials = loadTestUserCredentials();

test.skip(() => credentials === null, "TEST_USER_EMAIL / TEST_USER_PASSWORD(e2e-web/.env)が未設定のためスキップ");

const pad2 = (value: number): string => (value < 10 ? `0${value}` : String(value));

/**
 * 「先月の `day` 日」の ISO8601 を返す。
 *
 * ⚠️ 固定日付を書くと実行日によって Calendar に並ぶ月グリッドの数が変わる。先月に寄せることで
 * いつ回しても «同じ 1 か月の中に 2 日ぶんの記録がある» 形になる（未来日にもならない）。
 * 時刻を 03:00Z にしてあるのは、playwright.config.ts が固定している `Asia/Tokyo`（UTC+9）で
 * 見ても同じ日（12:00）に落ち、日境界・月境界をまたがないため。
 */
function lastMonthDayIso(day: number): string {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, day, 3, 0, 0)).toISOString();
}

/** 先月の `YYYY-MM`（Calendar の月グリッド testID に使う） */
function lastMonthYm(): string {
	const now = new Date();
	const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 3, 0, 0));
	return `${anchor.getUTCFullYear()}-${pad2(anchor.getUTCMonth() + 1)}`;
}

const WANT_AT = lastMonthDayIso(5);
const EATEN_AT = lastMonthDayIso(20);

const restaurant = {
	id: "11111111-1111-1111-1111-000000001403",
	name: "E2E 食堂",
	// 東京駅付近。Map は初回取得後にピンの外接矩形へ寄る
	latitude: 35.681236,
	longitude: 139.767125,
	image_url: null,
};

/** リスト / Calendar が読むフィールドだけを持つ最小の `MyDishItem` */
function buildItem(status: "want" | "eaten", occurredAt: string, name: string) {
	return {
		key: `${status}:${name}`,
		status,
		occurredAt,
		savedAt: status === "want" ? occurredAt : null,
		eatenAt: status === "eaten" ? occurredAt : null,
		restaurant,
		dish: {
			id: `dish-${name}`,
			restaurant_id: restaurant.id,
			category_id: "category-e2e",
			name,
			/*
			#1785 【契約】一覧・chip・Feed が出す «料理の表示名» は **`dish.name` ではなく
			`categoryLabels`** から来る（#1629 のオーナー確定。規則は
			app-expo/features/myDishes/dishCategoryLabel.ts）。
			ここが無いと `resolveDishCategoryLabel` が null を返し、画面には
			料理名の代わりに «写真なし» が出る。**モックに name しか無いと、
			アプリは正しいのにテストだけが落ちる。**
			*/
			categoryLabels: { ja: name, en: name },
			reviewCount: 1,
			averageRating: 4,
			// 写真なしの記録でも灰色プレースホルダーにしない契約（#1375 追補2 決定3）。
			// 実在しないホストなので画像自体は読めないが、カードの描画経路の確認には十分
			categoryImageUrl: "https://example.invalid/category.jpg",
		},
		dishMedia: null,
		myReview: status === "eaten" ? { rating: 4 } : null,
		distanceMeters: null,
	};
}

const WANT_ITEM = buildItem("want", WANT_AT, "E2E ラーメン");
const EATEN_ITEM = buildItem("eaten", EATEN_AT, "E2E カレー");

/** `MyDishPin`。ピンは店舗単位で 1 つ（#1375 §3） */
function buildPin(eatenCount: number, wantCount: number) {
	return {
		restaurant,
		counts: { want: wantCount, eaten: eatenCount },
		latestOccurredAt: EATEN_AT,
		representativeThumbnailUrl: null,
	};
}

/** 記録した 1 リクエスト（フィルタの反映を «クエリ» の側からも確かめるのに使う） */
type RecordedRequest = { path: "dishes" | "map-pins"; params: URLSearchParams };

/**
 * `v1/users/me/dishes` と `.../map-pins` を決定論的な値へ差し替える。
 *
 * **`status` が付いているかどうかで返す件数を変える**のがこの mock の肝である。
 * 「フィルタが 3 ビューへ効いた」ことを、クエリに `status` が乗ったかだけでなく
 * **3 ビューの描画が実際に減ったか**でも確かめられるようにする。
 *
 * @returns これまでに飛んだリクエストの記録（到着順）
 */
async function mockMyDishes(page: Page): Promise<RecordedRequest[]> {
	const recorded: RecordedRequest[] = [];

	/**
	 * CORS 込みで JSON を返す。
	 *
	 * API はビルド時に焼き込まれた Cloud Run の別オリジンなので、`Authorization` 付きの GET は
	 * プリフライト（OPTIONS）を伴う。`page.route` は pathname でしか判定しないため OPTIONS も
	 * 掴んでしまう。ここで 204 + CORS ヘッダを返さないと **プリフライトだけが落ちて本体が飛ばない**。
	 */
	const fulfillJson = async (route: Route, payload: unknown): Promise<void> => {
		const origin = (await route.request().headerValue("origin")) ?? "*";
		const cors = {
			"access-control-allow-origin": origin,
			"access-control-allow-credentials": "true",
			"access-control-allow-headers": "authorization,content-type,x-app-language,x-app-version",
			"access-control-allow-methods": "GET,POST,OPTIONS",
		};
		if (route.request().method() === "OPTIONS") {
			await route.fulfill({ status: 204, headers: cors, body: "" });
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			headers: cors,
			body: JSON.stringify({ success: true, data: payload }),
		});
	};

	// ── Map のピン ────────────────────────────────────────────────
	await page.route(
		(url: URL) => url.pathname.endsWith("/v1/users/me/dishes/map-pins"),
		async (route: Route) => {
			const params = new URL(route.request().url()).searchParams;
			recorded.push({ path: "map-pins", params });
			const status = params.get("status");
			await fulfillJson(route, {
				data: [status === "eaten" ? buildPin(1, 0) : buildPin(1, 1)],
				truncated: false,
			});
		},
	);

	// ── 一覧 / Calendar（同じ endpoint。Calendar は sort を落とした派生キーで読む） ──
	await page.route(
		// map-pins を掴まないよう pathname の完全一致で判定する
		(url: URL) => url.pathname.endsWith("/v1/users/me/dishes"),
		async (route: Route) => {
			const params = new URL(route.request().url()).searchParams;
			recorded.push({ path: "dishes", params });
			const status = params.get("status");
			const items =
				status === null ? [EATEN_ITEM, WANT_ITEM] : [EATEN_ITEM, WANT_ITEM].filter((i) => i.status === status);
			await fulfillJson(route, {
				data: items,
				nextCursor: null,
				meta: { oldestOccurredAt: null },
			});
		},
	);

	return recorded;
}

/** 直近の `path` のリクエストのクエリを返す（無ければ null） */
function lastRequest(recorded: RecordedRequest[], path: RecordedRequest["path"]): URLSearchParams | null {
	const hit = recorded.filter((r) => r.path === path);
	return hit.length > 0 ? hit[hit.length - 1].params : null;
}

/** `path` のリクエスト件数 */
function countRequests(recorded: RecordedRequest[], path: RecordedRequest["path"]): number {
	return recorded.filter((r) => r.path === path).length;
}

test.describe("my-dishes の 3 ビュー切替（web / ログイン済み）", () => {
	// ─ テストケース: list / Map / Calendar を切り替えられ、切替では取り直さない ─
	// 手順:
	//   1. 2 本の API を決定論的な値へ差し替える
	//   2. `?view=list` で着地し、リストビューだけが出ていることを検証
	//      （未訪問の Map / Calendar は **まだマウントされていない**ことも見る）
	//   3. Map へ切り替え → URL が `?view=map` になり、Map だけが見えることを検証
	//      list は DOM に残っている（keep-alive。#1396 M-1）ことも見る
	//   4. Calendar へ切り替え → Calendar だけが見えることを検証
	//   5. list へ戻す → 一覧の取得回数が **増えていない**ことを検証（§3-3）
	test("list / Map / Calendar を切り替えても取り直さず、訪問済みビューは残る", async ({ appPage }) => {
		const recorded = await mockMyDishes(appPage);
		const myDishes = new MyDishesPage(appPage);

		await myDishes.gotoView("list");
		await myDishes.expectOnlyViewVisible("list");
		await expect(myDishes.listItems).toHaveCount(2);

		// 未訪問のビューは «隠れている» のではなく «まだ無い»（#1396 M-1 の遅延マウント）
		await expect(myDishes.view("map")).toHaveCount(0);
		await expect(myDishes.view("calendar")).toHaveCount(0);

		// 一覧が読めた時点の取得回数を基準にする。
		// ⚠️ 描画が出てから数える前に少し待つこと。着地直後に飛んだ 2 本目が「基準を取った後」に
		// 記録されると、最後の «増えていない» の判定が **ビュー切替とは無関係な理由で**赤くなる
		await appPage.waitForTimeout(500);
		const dishesRequestsAfterList = countRequests(recorded, "dishes");
		expect(dishesRequestsAfterList).toBeGreaterThan(0);

		// ① Map へ（URL は履歴を積まずに書き換わる。`router.setParams`）
		await myDishes.selectView("map");
		await expect(appPage).toHaveURL(/[?&]view=map/);
		await myDishes.expectOnlyViewVisible("map");
		// keep-alive: list はアンマウントされず、隠れているだけ
		await expect(myDishes.view("list")).toBeAttached();

		// ② Calendar へ
		await myDishes.selectView("calendar");
		await expect(appPage).toHaveURL(/[?&]view=calendar/);
		await myDishes.expectOnlyViewVisible("calendar");
		await expect(myDishes.calendarDays).toHaveCount(2);

		// ③ list へ戻す
		await myDishes.selectView("list");
		await myDishes.expectOnlyViewVisible("list");
		await expect(myDishes.listItems).toHaveCount(2);

		// ★ 本命: ビュー切替では取り直さない（§3-3）。
		// Calendar は sort を落とした派生キーで読むが、共有 sort が既定（-occurredAt）の間は
		// base の queryKey と完全に一致するため、追加の取得は 1 回も起きない。
		// Map は別 endpoint（map-pins）なのでここには数えない
		await appPage.waitForTimeout(500);
		expect(countRequests(recorded, "dishes")).toBe(dishesRequestsAfterList);
	});

	// ─ テストケース: フィルタを 1 回適用すると 3 ビューすべてが同じ絞り込みになる ─
	// 手順:
	//   1. 2 本の API を差し替え、`?view=list` で着地して 3 ビューすべてを訪問しておく
	//      （keep-alive なので、以降は «見えている» ものを切り替えるだけになる）
	//   2. フィルタ画面を開き、状態「食べた」を選んで「適用する」
	//      （チップ押下はドラフト。store を書くのは「適用する」だけ。#1396 §8-5）
	//   3. list: 2 件あった棚が «食べた» 1 件へ削れることを検証
	//   4. Calendar: 記録がある日が 2 → 1 へ減ることを検証
	//   5. Map: `map-pins` のクエリにも同じ `status=eaten` が乗ることを検証
	//   6. 一覧側のクエリにも `status=eaten` が乗っていることを検証
	test("フィルタを適用すると list / Map / Calendar の 3 ビューすべてに効く", async ({ appPage }) => {
		const recorded = await mockMyDishes(appPage);
		const myDishes = new MyDishesPage(appPage);

		// 3 ビューとも «訪問済み» にしておく。未訪問だとマウント自体が後回しになり、
		// 「フィルタが効いた」のか「今マウントされて素で 1 件だったのか」を区別できない
		await myDishes.gotoView("list");
		await expect(myDishes.listItems).toHaveCount(2);
		await myDishes.selectView("map");
		await myDishes.selectView("calendar");
		await expect(myDishes.calendarDays).toHaveCount(2);

		// ★ 共有フィルタを書く唯一の操作
		await myDishes.applyStatusFilter("eaten");

		// ① Calendar（適用時に見ていたビュー）: 記録がある日が 1 つへ減る
		await myDishes.expectOnlyViewVisible("calendar");
		await expect(myDishes.calendarDays).toHaveCount(1);
		await expect(appPage.getByTestId(`my-dishes-calendar-month-${lastMonthYm()}`)).toBeAttached();

		// ② list: 棚も «食べた» 1 件へ削れる
		await myDishes.selectView("list");
		await expect(myDishes.listItems).toHaveCount(1);
		await expect(myDishes.view("list")).toContainText(EATEN_ITEM.dish.name);
		await expect(myDishes.view("list")).not.toContainText(WANT_ITEM.dish.name);

		// ③ Map: 同じ絞り込みがピンの取得クエリにも乗る
		await myDishes.selectView("map");
		await expect(async () => {
			expect(lastRequest(recorded, "map-pins")?.get("status")).toBe("eaten");
		}).toPass();

		// ④ 一覧側のクエリにも乗っている（描画とクエリの両面から見る）
		expect(lastRequest(recorded, "dishes")?.get("status")).toBe("eaten");
	});
});

/**
 * #1666 `restaurant_opening_hours` / `restaurant_hours_exceptions` から
 * 「今この店は開いているか」を **3値**（open / closed / unknown）で求める判定ロジックの正本。
 *
 * 3値にする理由（#1666 コメント参照、オーナー承認済み）:
 *   - `closed`（営業時間が分かっていて今閉まっている） → 検索結果から除外してよい
 *   - `unknown`（営業時間が分からない）                 → 無条件で候補に残す（今と同じ）
 *   - `open`（分かっていて開いている）                  → 現状の重みどおり微加点
 * `EXISTS(...)` のような2値にすると「データが無い店」と「閉まっている店」が同じ値になり、
 * coverage が低い（当面ごく一部）状況ではほぼ無風になる。
 *
 * ここは **DB にも Date にも触れない純関数** にしてある。呼び出し側（API の
 * `restaurant-opening-status.ts`）が Prisma から生データを取ってここへ渡すだけの薄い層になり、
 * 判定ロジック本体はここ1箇所だけを unit test で固定できる
 * （`shared/utils/priceBand.ts` と同じ構え。本番のロジックをテストへ写経しない）。
 */

/** 出所（source）。曜日ごとに OSM と公式サイトが食い違うのが普通なので、優先順位で解決する */
export type RestaurantHoursSource = 'osm' | 'official_site' | 'user' | 'owner';

/**
 * #1666 【設計】出所の優先順位（オーナー承認済み）。配列の先頭ほど優先。
 * 未知の source（想定外データ）が来た場合はどれとも一致しないため、
 * {@link resolveOpeningStatus} 側で決定的なフォールバック（source の辞書順）を用いる。
 */
export const RESTAURANT_HOURS_SOURCE_PRIORITY: readonly RestaurantHoursSource[] = [
	'official_site',
	'osm',
	'user',
	'owner',
];

/** `restaurant_opening_hours` の1行。分・曜日は呼び出し側（DB層）が変換して渡す */
export type RestaurantOpeningHourRow = {
	source: string;
	/** 0 = 日曜 … 6 = 土曜（PostgreSQL の EXTRACT(DOW) と同じ並び） */
	dayOfWeek: number;
	/** 0-1439（真夜中からの分） */
	opensAtMinutes: number;
	/** 0-1439（真夜中からの分） */
	closesAtMinutes: number;
	/** `closesAtMinutes <= opensAtMinutes`（18:00–02:00 のような深夜営業）のとき true */
	crossesMidnight: boolean;
};

/** `restaurant_hours_exceptions` の1行。休業なら opens/closes は null */
export type RestaurantHoursExceptionRow = {
	source: string;
	/** YYYY-MM-DD */
	exceptionDate: string;
	isClosed: boolean;
	opensAtMinutes: number | null;
	closesAtMinutes: number | null;
};

export type RestaurantOpeningStatus = 'open' | 'closed' | 'unknown';

/** {@link resolveOpeningStatus} が必要とする「今」の文脈。日をまたぐ判定のため前日ぶんも持つ */
export type OpeningStatusCalendarContext = {
	/** YYYY-MM-DD（判定対象の暦日） */
	todayDate: string;
	todayDayOfWeek: number;
	/** YYYY-MM-DD（前日。深夜営業の食い込みを拾うために使う） */
	yesterdayDate: string;
	yesterdayDayOfWeek: number;
	/** 0-1439（真夜中からの分） */
	nowMinutes: number;
};

/**
 * UTC の `now` から JST 基準の {@link OpeningStatusCalendarContext} を作る。
 *
 * ⚠️ **日本国内前提で JST 固定にしている。** `opens_at`/`closes_at` は TIME
 * （タイムゾーン無し）で店の現地時刻だが、店ごとのタイムゾーンを解決する仕組みが
 * まだ無い（`restaurants.country_code` はあるが、国 → タイムゾーンの変換は未実装）。
 * 海外店舗を扱うようになったら、ここを `country_code` 等から解決する形へ拡張すること。
 *
 * `Date` の `getUTCHours()` 系だけを使い、`getHours()`（ホストのローカル TZ 依存）は
 * 使わない。実行環境（CI / Cloud Run 等）のローカル TZ が UTC とは限らないため。
 */
export function deriveJstCalendarContext(nowUtc: Date): OpeningStatusCalendarContext {
	const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
	const DAY_MS = 24 * 60 * 60 * 1000;

	const jst = new Date(nowUtc.getTime() + JST_OFFSET_MS);
	const yesterday = new Date(jst.getTime() - DAY_MS);

	return {
		todayDate: jst.toISOString().slice(0, 10),
		todayDayOfWeek: jst.getUTCDay(),
		yesterdayDate: yesterday.toISOString().slice(0, 10),
		yesterdayDayOfWeek: yesterday.getUTCDay(),
		nowMinutes: jst.getUTCHours() * 60 + jst.getUTCMinutes(),
	};
}

/** 複数 source が同じ日/同じ日付を主張するとき、優先順位に従って1つだけ選ぶ */
function pickPrioritySource(sources: readonly string[]): string | null {
	if (sources.length === 0) return null;
	for (const candidate of RESTAURANT_HOURS_SOURCE_PRIORITY) {
		if (sources.includes(candidate)) return candidate;
	}
	// 優先順位表に無い source が来ても落ちないよう、決定的に（辞書順で）1つ選ぶ
	return [...sources].sort()[0];
}

type ResolvedWindow = {
	opensAtMinutes: number;
	closesAtMinutes: number;
	crossesMidnight: boolean;
};

/**
 * ある1つの暦日について「有効な営業コマ」を確定させる。
 *
 * - その日付の例外（`restaurant_hours_exceptions`）があれば、通常営業を**丸ごと上書き**する
 *   （休業なら空配列、時間指定ありならその1コマだけを返す）
 * - 例外が無ければ、その曜日の通常営業（`restaurant_opening_hours`）を返す
 * - source の優先順位解決は **この日の全コマ**（例外・通常営業それぞれ）に対して行う。
 *   「深夜営業ぶんだけ」のように先にコマの種類で絞ってから優先順位を決めると、
 *   優先 source がその日その種類のコマを持たないだけで劣後 source が誤って採用されうる
 *   （例: official_site がランチのみでディナー無し／osm がランチ・ディナー両方の場合、
 *   official_site の「ディナー無し」を正として扱う必要がある）
 */
function resolveEffectiveWindows(
	hoursForDay: readonly RestaurantOpeningHourRow[],
	exceptionsForDate: readonly RestaurantHoursExceptionRow[],
): ResolvedWindow[] {
	const exceptionSource = pickPrioritySource(exceptionsForDate.map((e) => e.source));
	if (exceptionSource !== null) {
		const exception = exceptionsForDate.find((e) => e.source === exceptionSource)!;
		if (exception.isClosed) return [];
		// #1666 migration の CHECK 制約により、is_closed=false なら opens/closes は必ず両方非 null
		const opensAtMinutes = exception.opensAtMinutes!;
		const closesAtMinutes = exception.closesAtMinutes!;
		return [
			{
				opensAtMinutes,
				closesAtMinutes,
				crossesMidnight: closesAtMinutes <= opensAtMinutes,
			},
		];
	}

	const hoursSource = pickPrioritySource(hoursForDay.map((h) => h.source));
	if (hoursSource === null) return [];
	return hoursForDay
		.filter((h) => h.source === hoursSource)
		.map((h) => ({
			opensAtMinutes: h.opensAtMinutes,
			closesAtMinutes: h.closesAtMinutes,
			crossesMidnight: h.crossesMidnight,
		}));
}

/**
 * `hours` / `exceptions`（対象レストラン1店ぶん）と現在時刻の文脈から、3値の営業状態を返す。
 *
 * 深夜営業（`18:00–02:00` のような `crossesMidnight` なコマ）は、前日の営業が
 * 「今日の 0:00–closesAt」へ食い込んでいるものとして扱う。ここを落とすと、
 * 深夜に「閉まっている」と誤判定し、朝食向けの3値フィルタの逆（夜の検索）が壊れる。
 */
export function resolveOpeningStatus(params: {
	hours: readonly RestaurantOpeningHourRow[];
	exceptions: readonly RestaurantHoursExceptionRow[];
	context: OpeningStatusCalendarContext;
}): RestaurantOpeningStatus {
	const { hours, exceptions, context } = params;
	const { todayDate, todayDayOfWeek, yesterdayDate, yesterdayDayOfWeek, nowMinutes } = context;

	// 今日始まるコマ（深夜営業なら今日ぶんは opensAt〜24:00 まで）
	const todayHours = hours.filter((h) => h.dayOfWeek === todayDayOfWeek);
	const todayExceptions = exceptions.filter((e) => e.exceptionDate === todayDate);
	const todayWindows = resolveEffectiveWindows(todayHours, todayExceptions);
	const isOpenViaTodayWindow = todayWindows.some((w) =>
		w.crossesMidnight
			? nowMinutes >= w.opensAtMinutes
			: nowMinutes >= w.opensAtMinutes && nowMinutes < w.closesAtMinutes,
	);

	// 前日始まりで日をまたいで今日へ食い込むコマ（0:00〜closesAt）
	const yesterdayHours = hours.filter((h) => h.dayOfWeek === yesterdayDayOfWeek);
	const yesterdayExceptions = exceptions.filter((e) => e.exceptionDate === yesterdayDate);
	const yesterdayWindows = resolveEffectiveWindows(yesterdayHours, yesterdayExceptions).filter(
		(w) => w.crossesMidnight,
	);
	const isOpenViaYesterdayCarry = yesterdayWindows.some((w) => nowMinutes < w.closesAtMinutes);

	if (isOpenViaTodayWindow || isOpenViaYesterdayCarry) return 'open';

	// 「分かっていて閉まっている」と言うには、この店の営業時間データ自体が
	// （どの曜日であれ）1件でも存在すること。1件も無ければ判定不能＝unknown
	const hasKnownData =
		hours.length > 0 ||
		exceptions.some((e) => e.exceptionDate === todayDate || e.exceptionDate === yesterdayDate);

	return hasKnownData ? 'closed' : 'unknown';
}

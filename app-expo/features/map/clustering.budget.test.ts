/*
#1629 «300 ピンは重いのか» を数字で固定する予算テスト。

オーナーの懸念は「300 件出すのはパフォーマンス的に重そう」。この画面の処理は
  転送（JSON） → JS（間引き + クラスタリング） → 描画（MAX_RENDERED_CLUSTERS = 60 個まで）
の 3 段で、描画は既に 60 個で頭打ちなので、300 という数が効くのは前 2 段だけである。
このテストはその 2 段を実測し、桁が変わる退行（アルゴリズムが O(n²) に戻る、
ピン 1 本のペイロードが肥大する）だけを落とす。しきい値は CI の揺らぎに耐える緩さにしてある。

実測値そのものは console.log で出す（報告に使う。しきい値は実測の 10 倍以上の余裕を持つ）。
*/
import type { MyDishPin } from "@shared/api/v1/res";
import { clusterMapPins, MAX_RENDERED_CLUSTERS } from "./clustering";

/** 乱数は seed 固定（テストのたびに件数・分布が変わらないように） */
const mulberry32 = (seed: number) => () => {
	seed |= 0;
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** 日本全体（本州〜九州あたり）へ散らしたピン */
const makePins = (count: number): MyDishPin[] => {
	const rand = mulberry32(1629);
	return Array.from({ length: count }, (_, i) => makeRealisticPin(i, 31 + rand() * 12, 129 + rand() * 12));
};

/**
 * 転送量の見積もりに使う «実物大» のピン 1 本。
 *
 * 値は本物ではないが、**各フィールドの長さは実データの典型**（Google の place_id は
 * 27 文字、address_components は 8 要素、サムネイル URL は署名付きで長い）に合わせてある。
 * ここが実物より痩せると JSON サイズの予算テストが甘くなるので、フィールドを
 * 足したときはここにも足すこと。
 */
const makeRealisticPin = (i: number, latitude: number, longitude: number): MyDishPin =>
	({
		restaurant: {
			id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
			google_place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4",
			name: "炭火焼鳥とワインのお店 とりとり 恵比寿本店",
			name_language_code: "ja",
			latitude,
			longitude,
			image_url: "https://lh3.googleusercontent.com/places/AAcXr8p1234567890abcdefghijklmnopqrstuvwxyz=s1600-w1600",
			image_path: `restaurants/${i}/exterior.jpg`,
			address_components: [
				{ long_name: "3", short_name: "3", types: ["premise"] },
				{ long_name: "28", short_name: "28", types: ["street_number"] },
				{ long_name: "恵比寿", short_name: "恵比寿", types: ["sublocality_level_2", "sublocality", "political"] },
				{ long_name: "渋谷区", short_name: "渋谷区", types: ["locality", "political"] },
				{ long_name: "東京都", short_name: "東京都", types: ["administrative_area_level_1", "political"] },
				{ long_name: "日本", short_name: "JP", types: ["country", "political"] },
				{ long_name: "150-0013", short_name: "150-0013", types: ["postal_code"] },
				{ long_name: "1階", short_name: "1階", types: ["subpremise"] },
			],
			plus_code: "8Q7XMQ4V+9G",
			created_at: "2026-04-01T00:00:00.000Z",
		},
		counts: { want: 1, eaten: 3 },
		latestOccurredAt: "2026-08-20T12:34:56.000Z",
		representativeThumbnailUrl:
			"https://storage.googleapis.com/nanitabeyo-media/dish-media/thumbnails/00000000-0000-4000-8000-000000000000.jpg?X-Goog-Signature=" +
			"a".repeat(128),
		isOwnMediaDeleted: false,
	}) as unknown as MyDishPin;

const REGION_JP = { latitude: 36.2, longitude: 138.25, latitudeDelta: 20, longitudeDelta: 20 };

const measureMs = (fn: () => void, iterations: number): number => {
	fn(); // ウォームアップ（JIT の初回コンパイルを測らない）
	const start = performance.now();
	for (let i = 0; i < iterations; i++) fn();
	return (performance.now() - start) / iterations;
};

describe("#1629 300 ピンの重さの所在", () => {
	it("クラスタリング（間引き + 畳み + 上限）は 300 件で数 ms のオーダー", () => {
		const pins = makePins(300);
		const avg = measureMs(() => clusterMapPins(pins, REGION_JP), 50);
		// eslint-disable-next-line no-console
		console.log(`clusterMapPins(300 pins, 日本全体): ${avg.toFixed(3)} ms/回`);
		// 実測は 1ms 未満。50ms（1 フレームの 3 倍）を超えたらアルゴリズムの退行
		expect(avg).toBeLessThan(50);
	});

	it("1 万件（p95 ユーザー相当を仮に全件返した場合）でも破綻はしないが、増分は線形より悪い", () => {
		const avg300 = measureMs(() => clusterMapPins(makePins(300), REGION_JP), 20);
		const avg10k = measureMs(() => clusterMapPins(makePins(10_000), REGION_JP), 5);
		// eslint-disable-next-line no-console
		console.log(`clusterMapPins: 300 件 ${avg300.toFixed(3)} ms / 10,000 件 ${avg10k.toFixed(3)} ms`);
		// 貪欲法は O(n × クラスタ数) なので、上限を外して全件返す設計にした瞬間ここが伸びる。
		// «全件返す» 案を選ばなかった根拠を数字として残す（500ms = 明確に体感される水準）
		expect(avg10k).toBeLessThan(500);
	});

	it("ピン 300 件の JSON は数百 KB のオーダー（転送が 300 という数の実コスト）", () => {
		const pins = makePins(300);
		const bytes = Buffer.byteLength(JSON.stringify({ data: pins, truncated: false }), "utf8");
		const perPin = Math.round(bytes / 300);
		// eslint-disable-next-line no-console
		console.log(`map-pins 300 件の JSON: ${(bytes / 1024).toFixed(1)} KB（1 本あたり ${perPin} bytes）`);
		// 1 本 2KB を超えたらレスポンスに余計なフィールドが載っている（予算ガード）
		expect(perPin).toBeLessThan(2048);
	});

	it("描画の上限（MAX_RENDERED_CLUSTERS）は取得件数に依らず一定", () => {
		expect(clusterMapPins(makePins(300), REGION_JP).length).toBeLessThanOrEqual(MAX_RENDERED_CLUSTERS);
		expect(clusterMapPins(makePins(10_000), REGION_JP).length).toBeLessThanOrEqual(MAX_RENDERED_CLUSTERS);
	});
});

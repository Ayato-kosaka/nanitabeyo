/*
#1629 «お店を選ぶ» 地図の数字（半径の上下限・点とラベルの切り替え）。

半径の上限は当初 50km だった（«日本全体から半径 1,000km を投げると落ちる» の対策）。
しかしそれは半径ではなく **クエリの形**の問題で、50km の頭打ちは
«引くと日本の中心から 50km しか探さない = 東京の店が 1 件も出ない» という実害だけを
残していた。いまはサーバ側が «スポンサー枠 + KNN 近傍枠» で候補を先に limit 件へ
絞るので、半径は «見えている範囲» をそのまま送る。

下限（寄りすぎて 0 件になる）は引き続き固定する。
*/
import {
	LABEL_ZOOM_MAX_DELTA,
	MAX_SEARCH_RADIUS_M,
	MIN_SEARCH_RADIUS_M,
	pinDetailLevelForRegion,
	radiusForRegion,
} from "./mapPins";

describe("radiusForRegion", () => {
	/*
	#1629 **修正前のコードで赤くなる回帰テスト。**
	修正前は 50,000（50km）で頭打ちだったので、日本全体を映すと «長野の山中から 50km» しか
	探さず、東京の店は 1 件も返らなかった（オーナー報告の «必ず 0 件»）。
	*/
	it("日本全体（20 度）では、東京までの距離（約 200km）を含む半径になる", () => {
		const radius = radiusForRegion({ latitude: 36.2048, latitudeDelta: 20, longitudeDelta: 20 });
		// 日本の中心（36.2048, 138.2529）から東京駅までは約 200km
		expect(radius).toBeGreaterThan(200_000);
		// 札幌・福岡（いずれも約 800km）まで届く = 本土が収まるスケール
		expect(radius).toBeGreaterThan(800_000);
		// それでも «壊れた値» の上限は超えない
		expect(radius).toBeLessThanOrEqual(MAX_SEARCH_RADIUS_M);
	});

	it("拡大しきっても 200m を下回らない（半径 0 で «1 件も返らない» を防ぐ）", () => {
		expect(radiusForRegion({ latitudeDelta: 0.0001, longitudeDelta: 0.0001 })).toBe(MIN_SEARCH_RADIUS_M);
	});

	it("上下限の内側では表示域に比例する（外接円 = 対角線の半分）", () => {
		// 赤道上（cos 0 = 1）なら 0.02 度 = 2,226.4m / 0.04 度 = 4,452.8m。その対角線の半分
		const expected = Math.round(Math.sqrt((0.02 * 111_320) ** 2 + (0.04 * 111_320) ** 2) / 2);
		expect(radiusForRegion({ latitude: 0, latitudeDelta: 0.02, longitudeDelta: 0.04 })).toBe(expected);
	});

	it("表示域が不正（NaN）でも下限へ丸める", () => {
		expect(radiusForRegion({ latitudeDelta: Number.NaN, longitudeDelta: Number.NaN })).toBe(MIN_SEARCH_RADIUS_M);
	});
});

describe("pinDetailLevelForRegion", () => {
	it("引いている（しきい値より広い）ときは点", () => {
		expect(pinDetailLevelForRegion({ latitudeDelta: 0.2, longitudeDelta: 0.2 })).toBe("dot");
	});

	it("しきい値ちょうどまでは店名つき", () => {
		expect(pinDetailLevelForRegion({ latitudeDelta: LABEL_ZOOM_MAX_DELTA, longitudeDelta: LABEL_ZOOM_MAX_DELTA })).toBe(
			"label",
		);
	});

	it("縦横のどちらかが広ければ点にする（横長の端末で名前が重なるのを防ぐ）", () => {
		expect(pinDetailLevelForRegion({ latitudeDelta: 0.01, longitudeDelta: 0.2 })).toBe("dot");
	});

	it("表示域が無い（初期表示）ときは店名つきに倒す", () => {
		expect(pinDetailLevelForRegion(null)).toBe("label");
	});
});

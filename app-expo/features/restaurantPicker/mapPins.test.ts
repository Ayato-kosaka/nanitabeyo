/*
#1629 «お店を選ぶ» 地図の数字（半径の上下限・点とラベルの切り替え）。

半径は #1629 の «日本全体を映したまま再検索すると半径 1,000km を投げて落ちる» の
再発防止そのものなので、上限だけでなく **下限**（寄りすぎて 0 件になる）も固定する。
*/
import {
	LABEL_ZOOM_MAX_DELTA,
	MAX_SEARCH_RADIUS_M,
	MIN_SEARCH_RADIUS_M,
	pinDetailLevelForRegion,
	radiusForRegion,
} from "./mapPins";

describe("radiusForRegion", () => {
	it("日本全体（20 度）でも 50km を超えない", () => {
		expect(radiusForRegion({ latitudeDelta: 20, longitudeDelta: 20 })).toBe(MAX_SEARCH_RADIUS_M);
	});

	it("拡大しきっても 200m を下回らない（半径 0 で «1 件も返らない» を防ぐ）", () => {
		expect(radiusForRegion({ latitudeDelta: 0.0001, longitudeDelta: 0.0001 })).toBe(MIN_SEARCH_RADIUS_M);
	});

	it("上下限の内側では表示域に比例する（縦横のうち広い方を使う）", () => {
		expect(radiusForRegion({ latitudeDelta: 0.02, longitudeDelta: 0.04 })).toBe(2000);
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

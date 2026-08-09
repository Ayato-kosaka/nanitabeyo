import { buildAddressFromGeocodedAddress, isCanonicalAddress } from "./addressFormat";

/**
 * #1196 `address` は表示用の文字列ではなく、料理カテゴリ推薦 API が地域ゲートの照合に使う
 * 機械可読なトークン列である。ここが崩れると `region:大阪市` のようなキーになり、
 * サーバ側の gate whitelist（日本向けは `region:country:JP` のみ）に当たらず候補0件 →
 * Claude フォールバックが常時発火する（本番で 1日 1,445件 / 204ユーザー）。
 *
 * サーバ側の判定 (`api/src/core/utils/address-format.ts`) と対になるテスト。
 */
describe("#1196 isCanonicalAddress", () => {
	it.each([
		"country:JP, administrative_area_level_1:Osaka, locality:Osaka",
		"country:JP, administrative_area_level_1:大阪府, locality:大阪市",
		"country:JP",
		"country:US, administrative_area_level_1:CA",
		"  country:JP ,  locality:Osaka  ",
	])("正規形式は true: %s", (address) => {
		expect(isCanonicalAddress(address)).toBe(true);
	});

	it.each([
		"大阪市",
		"名古屋市",
		"広島市",
		"新宿区",
		"横浜市",
		"柏市",
		"京都市",
		"東松山市",
		"中央区",
		"足立区",
		"北九州市",
		"仙台市",
	])("#1196 本番で観測された壊れた形式（市区町村名単体）は false: %s", (address) => {
		expect(isCanonicalAddress(address)).toBe(false);
	});

	it.each([
		["空文字", ""],
		["null", null],
		["undefined", undefined],
		["値の無い country トークン", "country:"],
		["expo フォールバックの表示用文字列", "現在地 (34.6937, 135.5023)"],
		["country が無く地域トークンだけ", "administrative_area_level_1:大阪府, locality:大阪市"],
		["country で始まるだけの別キー", "countryside:JP"],
	])("非正規形式は false: %s", (_label, address) => {
		expect(isCanonicalAddress(address)).toBe(false);
	});
});

describe("#1196 buildAddressFromGeocodedAddress", () => {
	it("expo の逆ジオコーディング結果から country → level_1 → locality の順で組み立てる", () => {
		expect(
			buildAddressFromGeocodedAddress({
				isoCountryCode: "JP",
				region: "大阪府",
				city: "大阪市",
			}),
		).toBe("country:JP, administrative_area_level_1:大阪府, locality:大阪市");
	});

	it("#1196 【本丸】組み立てた address は正規形式として通る（= 地域ゲートにマッチする）", () => {
		// 旧実装は `r.city` をそのまま使っていたため、まさにこの入力から "大阪市" を作っていた
		const address = buildAddressFromGeocodedAddress({
			isoCountryCode: "JP",
			region: "大阪府",
			city: "大阪市",
		});

		expect(address).not.toBe("大阪市");
		expect(isCanonicalAddress(address)).toBe(true);
	});

	it("city が無い場合は subregion を locality の代わりに使う", () => {
		expect(
			buildAddressFromGeocodedAddress({
				isoCountryCode: "JP",
				region: "東京都",
				city: null,
				subregion: "西多摩郡",
			}),
		).toBe("country:JP, administrative_area_level_1:東京都, locality:西多摩郡");
	});

	it("国コードだけでも正規形式になる（ゲートの照合に必要なのは country トークンだけ）", () => {
		const address = buildAddressFromGeocodedAddress({ isoCountryCode: "JP" });

		expect(address).toBe("country:JP");
		expect(isCanonicalAddress(address)).toBe(true);
	});

	it.each([
		["国コードが無い", { region: "大阪府", city: "大阪市" }],
		["国コードが空文字", { isoCountryCode: "  ", city: "大阪市" }],
		["結果が null", null],
		["結果が undefined", undefined],
	])("正規形式を作れない場合は null を返す: %s", (_label, geocoded) => {
		// #1196 【設計】ここで市区町村名だけを返すと障害が再発するため、必ず null にする
		expect(buildAddressFromGeocodedAddress(geocoded as never)).toBeNull();
	});
});

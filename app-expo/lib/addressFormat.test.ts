import { buildAddressFromGeocodedAddress, getAddressCountryCode, isCanonicalAddress } from "./addressFormat";

/**
 * #1196 `address` は表示用の文字列ではなく、料理カテゴリ推薦 API が地域ゲートの照合に使う
 * 機械可読なトークン列である。ここが崩れると `region:大阪市` のようなキーになり、
 * サーバ側の gate whitelist（日本向けは `region:country:JP` のみ）に当たらず候補0件 →
 * Claude フォールバックが常時発火する（本番で 1日 1,445件 / 204ユーザー）。
 *
 * 形式の担保はクライアント側の責務（サーバは検証しない — #1196）。
 * 本番で観測された壊れた実例をすべて false 側に固定し、再発を検知する。
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
		// #1196 Postgres の照合は大小文字区別ありなので `region:country:jp` はゲートに当たらない。
		// 前置詞だけを見ていると「正規形式なのにゲートに当たらない」という検知不能な穴になる。
		["小文字の国コード", "country:jp, administrative_area_level_1:Osaka"],
		["先頭だけ大文字の国コード", "country:Jp"],
		["alpha-2 でない国名", "country:Japan"],
	])("非正規形式は false: %s", (_label, address) => {
		expect(isCanonicalAddress(address)).toBe(false);
	});
});

/**
 * #1196 検索画面の海外ガード（`country:JP` 以外では推薦 API を呼ばずにダイアログで案内する）は、
 * この関数の戻り値だけを根拠に判断する。ここが緩むと海外の地点で API を呼んでしまい、
 * 候補が痩せて Claude フォールバックへ落ちる（課金だけ発生して結果は返せない）。
 * 逆に厳しすぎると日本の正常な地点で検索が止まるため、境界を明示的に固定する。
 */
describe("#1196 getAddressCountryCode", () => {
	it.each([
		["国コードのみ", "country:JP", "JP"],
		["日本の正規形式", "country:JP, administrative_area_level_1:大阪府, locality:大阪市", "JP"],
		["海外の正規形式", "country:US, administrative_area_level_1:CA, locality:San Francisco", "US"],
		["前後に空白", "  country:JP ,  locality:Osaka  ", "JP"],
		["country が先頭でない", "administrative_area_level_1:CA, country:US", "US"],
	])("正規形式からは国コードを返す: %s", (_label, address, expected) => {
		expect(getAddressCountryCode(address)).toBe(expected);
	});

	it.each([
		["#1196 本番で観測された壊れた形式", "大阪市"],
		["空文字", ""],
		["null", null],
		["undefined", undefined],
		["値の無い country トークン", "country:"],
		["expo フォールバックの表示用文字列", "現在地 (34.6937, 135.5023)"],
		["country が無く地域トークンだけ", "administrative_area_level_1:大阪府, locality:大阪市"],
		["country で始まるだけの別キー", "countryside:JP"],
		// #1196 Postgres の照合は大小文字区別ありなので `region:country:jp` はゲートに当たらない。
		// 「JP なのに小文字」を JP として通すと、海外ガードは素通しなのにサーバでは 0 件、という
		// 最も気づきにくい壊れ方（#1196 と同じ Claude フォールバック常時発火）になる。
		["小文字の国コード", "country:jp, administrative_area_level_1:Osaka"],
		["先頭だけ大文字の国コード", "country:Jp"],
		["alpha-2 でない国名", "country:Japan"],
	])("正規形式でなければ null: %s", (_label, address) => {
		expect(getAddressCountryCode(address)).toBeNull();
	});

	it("isCanonicalAddress は「国コードを取り出せること」と等価である", () => {
		for (const address of ["country:JP", "country:US, locality:NY", "大阪市", "country:jp", "", null, undefined]) {
			expect(isCanonicalAddress(address)).toBe(getAddressCountryCode(address) !== null);
		}
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

	it.each([
		["小文字", "jp"],
		["先頭だけ大文字", "Jp"],
		["前後に空白", " jp "],
	])("#1196 国コードは必ず大文字化する（Postgres の照合が大小文字区別ありのため）: %s", (_label, isoCountryCode) => {
		const address = buildAddressFromGeocodedAddress({
			isoCountryCode,
			region: "大阪府",
			city: "大阪市",
		});

		// `region:country:jp` はホワイトリストの `region:country:JP` に当たらないため、
		// ここが小文字のまま通ると #1196 が検知ログなしで再発する
		expect(address).toBe("country:JP, administrative_area_level_1:大阪府, locality:大阪市");
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

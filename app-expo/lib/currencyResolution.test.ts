/**
 * #843 通貨が確定しないまま金額を送らないことを固定するテスト。
 *
 * オープンデータ由来で作った店舗（619,508件）は `address_components` が空配列
 * なので、店から通貨を引けない。旧実装は `getMinorUnitDigits(null)` が既定の
 * 2 桁へ黙って落ちるため、円の「1000」が 100000 として送信されていた
 * （JPY は 0 桁）。エラーもログも出ないので、DB を見るまで気付けなかった。
 *
 * ここで固定するのは次の3点。
 *   1. 通貨が未確定なら金額変換は成功しない（例外で落ちる）
 *   2. 通貨が確定していれば、桁数は ISO-4217 に従う
 *   3. ロケールからの推定は «選択肢の初期カーソル» であって既定値ではない
 */
import {
	buildCurrencyChoices,
	getCurrencyCodeFromAddressComponents,
	getCurrencyCodeFromRestaurant,
	getMinorUnitDigits,
	resolveCurrencyCodeFromLocale,
	toMinorAmountInteger,
} from "./googlePlaces";

describe("#1780 店から通貨を引くときの出所", () => {
	// dev 実測: 621,974 店のうち address_components に country があるのは 2,476 店
	// （0.40%）だけ。一方 country_code 列は 621,964 店（100.00%）が埋まっている。
	// 列を見なければ、ほぼ全ての店でユーザーに通貨を選ばせることになる。
	it("address_components が空でも、country_code 列から通貨が決まる", () => {
		expect(
			getCurrencyCodeFromRestaurant({ address_components: [], country_code: "JP" }),
		).toBe("JPY");
	});

	it("address_components が無くても（列だけでも）決まる", () => {
		expect(getCurrencyCodeFromRestaurant({ country_code: "US" })).toBe("USD");
	});

	it("⚠️ address_components を優先する（列で上書きしない）", () => {
		const addressComponents = [{ shortText: "US", longText: "United States", types: ["country"] }];

		expect(
			getCurrencyCodeFromRestaurant({
				address_components: addressComponents,
				country_code: "JP",
			}),
		).toBe("USD");
	});

	it("⚠️ どちらからも引けなければ null（黙って既定値へ倒さない）", () => {
		// ここで 'JPY' などを返すと、円 0 桁 / ドル 2 桁の取り違えで
		// 「1000円」が 100000 として送信される（実際に起きた）
		expect(getCurrencyCodeFromRestaurant({ address_components: [], country_code: null })).toBeNull();
		expect(getCurrencyCodeFromRestaurant({})).toBeNull();
	});

	it("知らない国コードなら null", () => {
		expect(getCurrencyCodeFromRestaurant({ country_code: "ZZ" })).toBeNull();
	});
});

describe("通貨が未確定のときの金額変換", () => {
	it.each([null, undefined, ""])("通貨コードが %p なら例外を投げる", (code) => {
		expect(() => toMinorAmountInteger(1000, code as string | null)).toThrow(/通貨コードが未確定/);
	});

	it("旧実装で 100 倍になっていた «円 1000» は、通貨が確定していれば 1000 のまま", () => {
		expect(toMinorAmountInteger(1000, "JPY")).toBe(1000);
	});

	it("小数 2 桁の通貨は従来どおり 100 倍される", () => {
		expect(toMinorAmountInteger(10.5, "USD")).toBe(1050);
	});

	it("3 桁の通貨も ISO-4217 に従う", () => {
		expect(toMinorAmountInteger(1.234, "KWD")).toBe(1234);
	});
});

describe("店から通貨が引けるか", () => {
	it("address_components が空配列なら null（これが今回の 619,508 件）", () => {
		expect(getCurrencyCodeFromAddressComponents([])).toBeNull();
	});

	it("country があれば引ける", () => {
		expect(
			getCurrencyCodeFromAddressComponents([{ shortText: "JP", longText: "Japan", types: ["country"] }] as never),
		).toBe("JPY");
	});
});

describe("ロケールからの通貨推定", () => {
	it.each([
		["ja-JP", "JPY"],
		["ja_JP", "JPY"],
		["ja", "JPY"],
		["en-US", "USD"],
		["ko-KR", "KRW"],
	])("%s → %s", (locale, expected) => {
		expect(resolveCurrencyCodeFromLocale(locale)).toBe(expected);
	});

	it("対応表に無いロケールでは null を返す（勝手に既定値へ落とさない）", () => {
		expect(resolveCurrencyCodeFromLocale("xx-YY")).toBeNull();
	});

	it("推定できた通貨が選択肢の先頭に来る", () => {
		const choices = buildCurrencyChoices("ja-JP");
		expect(choices[0]).toBe("JPY");
		// 先頭へ寄せた分が重複して残らないこと
		expect(choices.filter((code) => code === "JPY")).toHaveLength(1);
	});

	it("推定できなくても選択肢自体は返る（ユーザーが選べる状態を保つ）", () => {
		expect(buildCurrencyChoices(null).length).toBeGreaterThan(0);
	});
});

describe("getMinorUnitDigits の既定値", () => {
	// 未知の «通貨コード» に対して 2 を返すこと自体は ISO-4217 の実務として妥当。
	// 問題だったのは «通貨が無い» ことを «未知の通貨» と同一視していた点なので、
	// 既定 2 桁は残したまま、null は toMinorAmountInteger 側で止める。
	it("未知の通貨コードは 2 桁", () => {
		expect(getMinorUnitDigits("ZZZ")).toBe(2);
	});

	it("JPY は 0 桁", () => {
		expect(getMinorUnitDigits("JPY")).toBe(0);
	});
});

import { isRtlLocale } from "./rtlLocales";
import { PUBLIC_LOCALES } from "@shared/api/v1/constants/publicLocales";

describe("isRtlLocale", () => {
	it("アラビア語（ar-SA）は RTL と判定する", () => {
		expect(isRtlLocale("ar-SA")).toBe(true);
		expect(isRtlLocale("ar")).toBe(true);
	});

	it("大文字小文字を無視する", () => {
		expect(isRtlLocale("AR-SA")).toBe(true);
	});

	it("PUBLIC_LOCALES のうち RTL は ar-SA だけ（現時点の仮定を固定する）", () => {
		const rtl = PUBLIC_LOCALES.filter(isRtlLocale);
		expect(rtl).toEqual(["ar-SA"]);
	});

	it("LTR 言語は false を返す", () => {
		expect(isRtlLocale("ja-JP")).toBe(false);
		expect(isRtlLocale("en-US")).toBe(false);
	});
});

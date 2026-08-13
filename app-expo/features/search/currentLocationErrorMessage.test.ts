import type { LocationPermissionErrorKind } from "@/hooks/locationPermissionError";
import { getCurrentLocationErrorMessage, shouldFallbackToManualInput } from "./currentLocationErrorMessage";

// 翻訳の中身ではなく「どのキーを引いたか」を固定したいので、t はキーをそのまま返す
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

/**
 * #1133 現在地取得の失敗表示は、ホーム（検索タブ）と保存料理タブで**同一**でなければならない。
 *
 * 同じ「権限拒否」でも画面ごとに文言や導線が違うと、ユーザーは「別の不具合」だと受け取る。
 * ここで kind → 翻訳キーの対応と、手入力へ誘導すべき kind を固定しておくことで、
 * 片方の画面だけ書き換わる事故を防ぐ。
 */
describe("#1133 現在地取得の失敗文言は kind ごとに出し分ける", () => {
	it.each<[LocationPermissionErrorKind, string]>([
		["denied", "Search.errors.getCurrentLocationDenied"],
		["unsupported", "Search.errors.getCurrentLocationUnsupported"],
		["timeout", "Search.errors.getCurrentLocationTimeout"],
		["unavailable", "Search.errors.getCurrentLocation"],
	])("kind=%s のとき %s を引く", (kind, expectedKey) => {
		expect(getCurrentLocationErrorMessage(kind)).toBe(expectedKey);
	});

	it("未知の kind は汎用の文言へ落とす（分類が増えても無言で失敗しない）", () => {
		expect(getCurrentLocationErrorMessage("something_new" as LocationPermissionErrorKind)).toBe(
			"Search.errors.getCurrentLocation",
		);
	});
});

describe("#1133 手入力へ誘導すべき失敗の判定", () => {
	it.each<[LocationPermissionErrorKind, boolean]>([
		// 再試行しても解決しない → 手入力へ誘導する
		["denied", true],
		["unsupported", true],
		// 再試行で解決しうる → フォーカスを奪わず、もう一度現在地ボタンを押せるままにする
		["timeout", false],
		["unavailable", false],
	])("kind=%s のとき %s", (kind, expected) => {
		expect(shouldFallbackToManualInput(kind)).toBe(expected);
	});
});

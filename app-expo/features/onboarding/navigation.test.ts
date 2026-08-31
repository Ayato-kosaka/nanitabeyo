/*
#1486 オンボーディング導線の «行き先» を固定するテスト。

router を触らない純関数だけを対象にしている（features/onboarding/navigation.ts の冒頭を参照）。
実機・実ブラウザでしか再現しづらい経路（ログイン後の全画面リダイレクト、ATT の割り込み）に
関わる判定なので、分岐そのものをここで固めておく。
*/
import { ONBOARDING_STEPS, clampStepIndex } from "./constants";
import {
	appRootPath,
	isOnboardingPath,
	onboardingIndexPath,
	onboardingLocationPath,
	onboardingLoginPath,
	onboardingNotificationsPath,
	onboardingWelcomePath,
	parseOnboardingMode,
	resolveAfterLocationPath,
} from "./navigation";

describe("clampStepIndex", () => {
	/**
	 * #1486 【バグ】「次へ」を連打すると、複数のハンドラが **同じ `stepIndex`** を読むため
	 * `setStepIndex((i) => i + 1)` が続けて走り、添字が範囲外へ出る。
	 * そのまま描画すると `ONBOARDING_STEPS[3]` が undefined になり、
	 * `step.empathyImage` で **画面が丸ごと落ちる**（e2e-web の連打テストが実際に捕まえた）。
	 */
	it("最終ページを越えない", () => {
		expect(clampStepIndex(ONBOARDING_STEPS.length - 1)).toBe(ONBOARDING_STEPS.length - 1);
		expect(clampStepIndex(ONBOARDING_STEPS.length)).toBe(ONBOARDING_STEPS.length - 1);
		expect(clampStepIndex(99)).toBe(ONBOARDING_STEPS.length - 1);
	});

	it("1 枚目より手前へ行かない", () => {
		expect(clampStepIndex(0)).toBe(0);
		expect(clampStepIndex(-1)).toBe(0);
		expect(clampStepIndex(-99)).toBe(0);
	});

	it("範囲内はそのまま返す", () => {
		for (let index = 0; index < ONBOARDING_STEPS.length; index += 1) {
			expect(clampStepIndex(index)).toBe(index);
		}
	});

	/** クランプ済みの添字なら、必ず実体のあるステップを引ける（描画側の前提） */
	it("クランプした添字で必ずステップを引ける", () => {
		for (const index of [-5, 0, 1, 2, 3, 10]) {
			expect(ONBOARDING_STEPS[clampStepIndex(index)]).toBeDefined();
		}
	});
});

describe("parseOnboardingMode", () => {
	it("manual だけを manual として扱う", () => {
		expect(parseOnboardingMode("manual")).toBe("manual");
	});

	it.each([undefined, "", "full", "MANUAL", "auto", 1, null, ["manual"]])("%p は初回導線(full)へ倒す", (input) => {
		expect(parseOnboardingMode(input)).toBe("full");
	});
});

describe("各画面のパス", () => {
	it("初回導線では mode を付けない", () => {
		expect(onboardingIndexPath("ja-JP")).toBe("/ja-JP/onboarding");
	});

	it("`？` から開くときは mode=manual を付ける", () => {
		expect(onboardingIndexPath("ja-JP", "manual")).toBe("/ja-JP/onboarding?mode=manual");
	});

	it("許可フローと Welcome は locale 配下に並ぶ", () => {
		expect(onboardingLocationPath("ja-JP")).toBe("/ja-JP/onboarding/location");
		expect(onboardingNotificationsPath("ja-JP")).toBe("/ja-JP/onboarding/notifications");
		expect(onboardingWelcomePath("ja-JP")).toBe("/ja-JP/onboarding/welcome");
		expect(appRootPath("ja-JP")).toBe("/ja-JP/(tabs)/search");
	});
});

describe("onboardingLoginPath", () => {
	/**
	 * `next` は URL のクエリに載るので、そのまま連結すると `/` や `?` が
	 * クエリの区切りとして解釈されうる。エンコードして 1 つの値として渡すこと。
	 */
	it("next を URL エンコードして渡す", () => {
		expect(onboardingLoginPath("ja-JP")).toBe("/ja-JP/auth/login?next=%2Fja-JP%2Fonboarding%2Flocation&skippable=1");
	});

	/**
	 * #1486 §4 スキップは «オンボーディングから来たときだけ» 出す。
	 * 印を落とすと、ログインが必須の画面（口コミ投稿など）から来た人も素通りできてしまう。
	 */
	it("skippable=1 を必ず付ける", () => {
		expect(onboardingLoginPath("en-US")).toContain("skippable=1");
	});

	it("locale を跨いでも自分の locale の行き先を指す", () => {
		expect(decodeURIComponent(onboardingLoginPath("ko-KR"))).toContain("/ko-KR/onboarding/location");
	});
});

describe("resolveAfterLocationPath", () => {
	// #1486 §6 通知許可はログイン済みユーザーのみ
	it("ログイン済みなら通知許可へ進む", () => {
		expect(resolveAfterLocationPath({ isLoggedIn: true, locale: "ja-JP" })).toBe("/ja-JP/onboarding/notifications");
	});

	it("未ログインなら通知を飛ばして Welcome へ進む", () => {
		expect(resolveAfterLocationPath({ isLoggedIn: false, locale: "ja-JP" })).toBe("/ja-JP/onboarding/welcome");
	});
});

describe("isOnboardingPath", () => {
	// #1486 §8 ここが true の間は ATT を要求しない
	it.each([
		"/ja-JP/onboarding",
		"/ja-JP/onboarding/location",
		"/ja-JP/onboarding/notifications",
		"/ja-JP/onboarding/welcome",
		"/ja-JP/auth/login",
		"/ja-JP/auth/callback",
	])("%s はオンボーディング導線の途中", (pathname) => {
		expect(isOnboardingPath(pathname)).toBe(true);
	});

	it.each(["/ja-JP", "/ja-JP/(tabs)/search", "/ja-JP/(tabs)/search/dish-categories", "/ja-JP/profile", "/"])(
		"%s は導線の外",
		(pathname) => {
			expect(isOnboardingPath(pathname)).toBe(false);
		},
	);

	/**
	 * 部分一致で誤判定しないこと。ここが緩いと、名前が似ているだけの画面で
	 * ATT が永久に要求されなくなる（症状が «何も起きない» なので気づきにくい）。
	 */
	it.each(["/ja-JP/onboardingx", "/ja-JP/preonboarding", "/ja-JP/auth/login-help"])(
		"%s は導線の外として扱う",
		(pathname) => {
			expect(isOnboardingPath(pathname)).toBe(false);
		},
	);
});

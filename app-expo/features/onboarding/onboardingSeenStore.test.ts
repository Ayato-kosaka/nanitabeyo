/*
#1486 §3 / §7 オンボーディング既読フラグのテスト。

守りたい不変条件は 3 つ。

1. **キーが旧チュートリアルのまま**であること（変えると既存ユーザー全員に再表示される）
2. 読み込み前は `null` で、既読とも未読とも判定されないこと
3. 書き手（Welcome 画面）の更新が、別ツリーの読み手（検索画面 / Meta 初期化）へ届くこと
*/
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
	ONBOARDING_STORAGE_KEY,
	__resetOnboardingSeenStoreForTest,
	getOnboardingSeenSnapshot,
	loadOnboardingSeen,
	markOnboardingSeen,
	resetOnboardingSeen,
	subscribeOnboardingSeen,
} from "./onboardingSeenStore";

beforeEach(async () => {
	__resetOnboardingSeenStoreForTest();
	await AsyncStorage.clear();
	jest.clearAllMocks();
});

describe("ストレージキー", () => {
	/**
	 * #1486 §3【要件】「既存チュートリアルと同じローカルストレージキーをそのまま利用」。
	 *
	 * e2e-web/utils/storage.ts の `TUTORIAL_STORAGE_KEY` とも一致させること。
	 * この値を変えると、既に既読の全ユーザーへオンボーディングが再表示される。
	 */
	it("旧チュートリアルと同じキーを使う", () => {
		expect(ONBOARDING_STORAGE_KEY).toBe("search_tutorial_seen_v1");
	});
});

describe("読み込み", () => {
	it("読み込み前のスナップショットは null（未読と判定してはいけない）", () => {
		expect(getOnboardingSeenSnapshot()).toBeNull();
	});

	it("保存が無ければ未読", async () => {
		await expect(loadOnboardingSeen()).resolves.toBe(false);
		expect(getOnboardingSeenSnapshot()).toBe(false);
	});

	it("既存ユーザー（既読で保存済み）は既読として読む", async () => {
		await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, "true");

		await expect(loadOnboardingSeen()).resolves.toBe(true);
		expect(getOnboardingSeenSnapshot()).toBe(true);
	});

	it("何度呼んでも AsyncStorage は 1 回しか読まない", async () => {
		await Promise.all([loadOnboardingSeen(), loadOnboardingSeen(), loadOnboardingSeen()]);

		expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
	});

	/**
	 * 読めなかった場合は未読へ倒す。ここで throw するとアプリが起動しなくなるのに対し、
	 * 倒したときの最悪はオンボーディングが 1 回余分に出るだけ（旧実装と同じ方針）。
	 */
	it("読み込みに失敗しても例外を投げず未読へ倒す", async () => {
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
		(AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("storage is broken"));

		await expect(loadOnboardingSeen()).resolves.toBe(false);
		expect(getOnboardingSeenSnapshot()).toBe(false);

		consoleError.mockRestore();
	});
});

describe("完了の確定", () => {
	it("既読として保存し、スナップショットへ即座に反映する", async () => {
		await markOnboardingSeen();

		expect(getOnboardingSeenSnapshot()).toBe(true);
		await expect(AsyncStorage.getItem(ONBOARDING_STORAGE_KEY)).resolves.toBe("true");
	});

	/**
	 * #1486 §7 Welcome 画面（書き手）と検索画面 / Meta 初期化（読み手）は別ツリーに居る。
	 * 購読が届かないと、完了直後の検索画面が古い値を読んでオンボーディングへ送り返す。
	 */
	it("購読者へ変化が通知される", async () => {
		const listener = jest.fn();
		subscribeOnboardingSeen(listener);

		await markOnboardingSeen();

		expect(listener).toHaveBeenCalled();
	});

	it("解除した購読者には通知しない", async () => {
		const listener = jest.fn();
		subscribeOnboardingSeen(listener)();

		await markOnboardingSeen();

		expect(listener).not.toHaveBeenCalled();
	});

	/**
	 * 「はじめる」の直後に読み込みが完了すると、AsyncStorage の古い値（未読）で
	 * 上書きされうる。確定後の読み込みは必ず既読を返すこと。
	 */
	it("確定後に読み込んでも未読へ戻らない", async () => {
		await markOnboardingSeen();

		await expect(loadOnboardingSeen()).resolves.toBe(true);
		expect(getOnboardingSeenSnapshot()).toBe(true);
	});

	it("書き込みに失敗してもこのセッションでは既読として扱う", async () => {
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
		(AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("storage is full"));

		await expect(markOnboardingSeen()).resolves.toBeUndefined();
		expect(getOnboardingSeenSnapshot()).toBe(true);

		consoleError.mockRestore();
	});
});

describe("リセット", () => {
	it("未読へ戻し、保存も消す", async () => {
		await markOnboardingSeen();

		await resetOnboardingSeen();

		expect(getOnboardingSeenSnapshot()).toBe(false);
		await expect(AsyncStorage.getItem(ONBOARDING_STORAGE_KEY)).resolves.toBeNull();
		await expect(loadOnboardingSeen()).resolves.toBe(false);
	});
});

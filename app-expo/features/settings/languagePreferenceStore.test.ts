import AsyncStorage from "@react-native-async-storage/async-storage";

import {
	LANGUAGE_PREFERENCE_STORAGE_KEY,
	loadLanguagePreference,
	saveLanguagePreference,
} from "./languagePreferenceStore";

beforeEach(async () => {
	await AsyncStorage.clear();
	jest.clearAllMocks();
});

describe("loadLanguagePreference", () => {
	it("保存が無ければ「端末設定に従う」", async () => {
		await expect(loadLanguagePreference()).resolves.toBe("system");
	});

	it("保存済みの公開ロケールをそのまま返す", async () => {
		await AsyncStorage.setItem(LANGUAGE_PREFERENCE_STORAGE_KEY, "fr-FR");
		await expect(loadLanguagePreference()).resolves.toBe("fr-FR");
	});

	it("保存値が公開ロケールでなければ「端末設定に従う」へ倒す（壊れた値からの自己修復）", async () => {
		await AsyncStorage.setItem(LANGUAGE_PREFERENCE_STORAGE_KEY, "xx-XX");
		await expect(loadLanguagePreference()).resolves.toBe("system");
	});

	it("読み込みに失敗しても例外を投げず「端末設定に従う」へ倒す", async () => {
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
		(AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("storage is broken"));

		await expect(loadLanguagePreference()).resolves.toBe("system");

		consoleError.mockRestore();
	});
});

describe("saveLanguagePreference", () => {
	it("公開ロケールを保存する", async () => {
		await saveLanguagePreference("ko-KR");
		await expect(AsyncStorage.getItem(LANGUAGE_PREFERENCE_STORAGE_KEY)).resolves.toBe("ko-KR");
	});

	it("「端末設定に従う」を選ぶと保存値を消す", async () => {
		await saveLanguagePreference("ko-KR");
		await saveLanguagePreference("system");

		await expect(AsyncStorage.getItem(LANGUAGE_PREFERENCE_STORAGE_KEY)).resolves.toBeNull();
		await expect(loadLanguagePreference()).resolves.toBe("system");
	});

	it("書き込みに失敗しても例外を投げない", async () => {
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
		(AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("storage is full"));

		await expect(saveLanguagePreference("ja-JP")).resolves.toBeUndefined();

		consoleError.mockRestore();
	});
});

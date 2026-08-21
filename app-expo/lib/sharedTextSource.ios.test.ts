/**
 * #1400（親 #1375）PR3: iOS の共有（Share Extension + App Group）の受け取りを固定する。
 *
 * ## 実機が使えないので、ネイティブ境界と `Linking` だけをモックする
 *
 * iOS は Android と異なり `hasShareIntent()` が常に `false` を返すため（`sharedTextSource.ios.ts`
 * の doc コメント参照）、「共有から起動されたか」の判定は `Linking.getInitialURL()` が
 * 拡張のディープリンク（`<scheme>://dataUrl=<scheme>ShareKey#...`）を返すかどうかで行う。
 * ここをモックすれば「共有が来たとき何が起きるか」は実機無しで全部固定できる。
 *
 * ## ここで守っているもの（Android と対称、2 点だけ異なる）
 * 1. 起動時の共有は **初回だけ返す**（2 回目は `null`、ネイティブも `Linking` も叩かない）
 * 2. 読んだらネイティブ側の保持を**必ずクリアする**
 * 3. `type: "text"` に加えて **`type: "weburl"` も採用する**（iOS 固有。doc コメント参照）
 * 4. URL でない共有テキストは **落とさずそのまま流す**（判定は `parseSnsUrl()` の仕事）
 * 5. 起動時の 1 本が購読側へ **二重に流れない**
 * 6. 購読解除でネイティブと `Linking` の購読も手放す（リークしない・二重解除で壊れない）
 * 7. **ディープリンクの形をしていない URL（他のユニバーサルリンク等）では何もしない**（iOS 固有）
 *
 * モジュールスコープの状態（`hasReadInitial` / 参照カウント）を検証対象にしているので、
 * テストごとに `jest.resetModules()` して読み直す（Android のテストと同じ作法）。
 */

/** `Constants.expoConfig.scheme` を実機の app.config.ts（"nanitabeyo"）に固定する。
 *  jest.setup.js の既定モックは jest-expo が app.config.ts を評価しないため scheme を持たない
 *  （このスキームが無いと `dataUrl=` プレフィックスが組めず、全テストが意味を持たなくなる）。 */
jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: { scheme: "nanitabeyo" } },
}));

/** `Linking.getInitialURL()` / `Linking.addEventListener("url", ...)` の実機の代わり */
const mockLinkingListeners = new Set<(event: { url: string }) => void>();
let mockInitialUrl: string | null = null;

jest.mock("expo-linking", () => ({
	__esModule: true,
	getInitialURL: jest.fn(async () => mockInitialUrl),
	addEventListener: jest.fn((_type: "url", handler: (event: { url: string }) => void) => {
		mockLinkingListeners.add(handler);
		return {
			remove: () => {
				mockLinkingListeners.delete(handler);
			},
		};
	}),
}));

/** ネイティブが `onChange` を配るときに呼ぶリスナー置き場（実機の EventEmitter の代わり） */
const mockNativeListeners = new Set<(event: { value: unknown }) => void>();

const mockShareIntentModule = {
	getShareIntent: jest.fn(async (_url: string): Promise<void> => {}),
	clearShareIntent: jest.fn((_key: string): void => {}),
	addListener: jest.fn((_eventName: string, listener: (event: { value: unknown }) => void) => {
		mockNativeListeners.add(listener);
		return {
			remove: () => {
				mockNativeListeners.delete(listener);
			},
		};
	}),
};

jest.mock("expo-share-intent/build/ExpoShareIntentModule", () => ({
	__esModule: true,
	default: mockShareIntentModule,
}));

/** ネイティブから `onChange` が飛んできた状況を作る */
const emitNativeShare = (value: unknown) => {
	for (const listener of [...mockNativeListeners]) listener({ value });
};

/** 拡張が発行するディープリンクを受け取った状況を作る（起動済みアプリへの共有） */
const emitLinkingUrl = (url: string) => {
	for (const listener of [...mockLinkingListeners]) listener({ url });
};

/**
 * Metro は iOS で `sharedTextSource.ios.ts` を選ぶが、jest-expo の既定プラットフォームも ios。
 * 拡張子まで書いて直接読むのは Android のテストと作法を揃えるため。
 */
const loadSource = () => {
	jest.resetModules();
	return (require("./sharedTextSource.ios") as typeof import("./sharedTextSource.ios")).sharedTextSource;
};

const SCHEME = "nanitabeyo";
const SHARE_DATA_URL = `${SCHEME}://dataUrl=${SCHEME}ShareKey#text`;
const SHARE_DATA_URL_WEBURL = `${SCHEME}://dataUrl=${SCHEME}ShareKey#weburl`;
const TIKTOK_URL = "https://www.tiktok.com/@cookpad/video/7261234567890123456";

/** text 共有としてネイティブが送ってくる形（`ExpoShareIntentModule.swift` の `ShareIntentText`） */
const textShare = (text: string) => JSON.stringify({ text, type: "text" });
/** weburl 共有としてネイティブが送ってくる形（SNS アプリの主要経路。doc コメント参照） */
const weburlShare = (url: string) => JSON.stringify({ weburls: [{ url, meta: "" }], type: "weburl" });

beforeEach(() => {
	mockNativeListeners.clear();
	mockLinkingListeners.clear();
	mockInitialUrl = null;
	// clearMocks: true は呼び出し履歴しか消さない。mockImplementation は
	// 前のテストのものが残るので、ここで既定へ戻す
	mockShareIntentModule.getShareIntent.mockImplementation(async () => {});
	mockShareIntentModule.clearShareIntent.mockImplementation(() => {});
});

/** 「共有から起動された」状況。`getShareIntent(url)` が呼ばれたら `onChange` が飛ぶ */
const givenColdStartShare = (url: string, value: unknown) => {
	mockInitialUrl = url;
	mockShareIntentModule.getShareIntent.mockImplementation(async () => {
		emitNativeShare(value);
	});
};

describe("getInitialSharedText（コールドスタートの共有）", () => {
	it("weburl 共有（URL 単体）から起動されたら、その URL を返す", async () => {
		const source = loadSource();
		givenColdStartShare(SHARE_DATA_URL_WEBURL, weburlShare(TIKTOK_URL));

		await expect(source.getInitialSharedText()).resolves.toBe(TIKTOK_URL);
	});

	it("text 共有（説明文つき）から起動されたら、その文字列を返す", async () => {
		const source = loadSource();
		givenColdStartShare(SHARE_DATA_URL, textShare("この店おいしかった"));

		await expect(source.getInitialSharedText()).resolves.toBe("この店おいしかった");
	});

	// ★ 本題。`getInitialURL()` が «起動時の URL» を返し続ける罠（app/index.tsx:23,72,97 と同じ）
	it("2 回目以降は null を返し、ネイティブも Linking も叩かない（同じ共有を 2 回取り込まない）", async () => {
		const source = loadSource();
		givenColdStartShare(SHARE_DATA_URL, textShare("この店おいしかった"));

		await expect(source.getInitialSharedText()).resolves.toBe("この店おいしかった");
		expect(mockShareIntentModule.getShareIntent).toHaveBeenCalledTimes(1);

		await expect(source.getInitialSharedText()).resolves.toBeNull();
		await expect(source.getInitialSharedText()).resolves.toBeNull();
		expect(mockShareIntentModule.getShareIntent).toHaveBeenCalledTimes(1);
	});

	// 読んだらネイティブ側の保持もクリアする。JS のフラグはプロセスが変われば消える
	it("読んだらネイティブ側の保持もクリアする", async () => {
		const source = loadSource();
		givenColdStartShare(SHARE_DATA_URL, textShare("この店おいしかった"));

		await source.getInitialSharedText();

		expect(mockShareIntentModule.clearShareIntent).toHaveBeenCalledWith(`${SCHEME}ShareKey`);
	});

	it("共有以外（通常起動・ユニバーサルリンク）で起動したときはネイティブを叩かずに null", async () => {
		const source = loadSource();
		mockInitialUrl = "https://app.nanitabeyo.net/ja/spots/123";

		await expect(source.getInitialSharedText()).resolves.toBeNull();
		expect(mockShareIntentModule.getShareIntent).not.toHaveBeenCalled();
	});

	it("起動時の URL が無い（通常のランチャー起動）ときも null", async () => {
		const source = loadSource();
		mockInitialUrl = null;

		await expect(source.getInitialSharedText()).resolves.toBeNull();
		expect(mockShareIntentModule.getShareIntent).not.toHaveBeenCalled();
	});

	it("URL でない共有テキストも落とさずそのまま返す（判定は parseSnsUrl の仕事）", async () => {
		const source = loadSource();
		givenColdStartShare(SHARE_DATA_URL, textShare("この店おいしかった"));

		await expect(source.getInitialSharedText()).resolves.toBe("この店おいしかった");
	});

	it.each([
		["画像・ファイルの共有（type: media）", { type: "media", files: [{ fileName: "a.jpg" }] }],
		["text だが中身が空白だけ", { text: "   ", type: "text" }],
		["text が欠けている", { type: "text" }],
		["weburl だが配列が空", { weburls: [], type: "weburl" }],
		["weburl の url が空白だけ", { weburls: [{ url: "  ", meta: "" }], type: "weburl" }],
		["value が JSON として壊れている", "not-json"],
	])("採用できない共有は無視する: %s", async (_label, value) => {
		const source = loadSource();
		givenColdStartShare(SHARE_DATA_URL, typeof value === "string" ? value : JSON.stringify(value));

		await expect(source.getInitialSharedText()).resolves.toBeNull();
	});

	// dataUrl= 形式でないディープリンクでは getShareIntent を呼ばない（iOS 固有の判定）
	it("dataUrl= の形をしていない URL では何もしない", async () => {
		const source = loadSource();
		mockInitialUrl = `${SCHEME}://some-other-deep-link`;

		await expect(source.getInitialSharedText()).resolves.toBeNull();
		expect(mockShareIntentModule.getShareIntent).not.toHaveBeenCalled();
	});

	it("dataUrl= と言われたのにイベントが来なければ、待ち続けずに null で諦める", async () => {
		jest.useFakeTimers();
		try {
			const source = loadSource();
			mockInitialUrl = SHARE_DATA_URL;
			mockShareIntentModule.getShareIntent.mockImplementation(async () => {});

			const pending = source.getInitialSharedText();
			await jest.advanceTimersByTimeAsync(5000);

			await expect(pending).resolves.toBeNull();
		} finally {
			jest.useRealTimers();
		}
	});

	it("Linking.getInitialURL が投げてもアプリを止めない（起動できない方が害が大きい）", async () => {
		const source = loadSource();
		const linking = require("expo-linking") as { getInitialURL: jest.Mock };
		linking.getInitialURL.mockRejectedValueOnce(new Error("linking unavailable"));

		await expect(source.getInitialSharedText()).resolves.toBeNull();
	});

	it("getShareIntent が失敗しても null で畳む", async () => {
		const source = loadSource();
		mockInitialUrl = SHARE_DATA_URL;
		mockShareIntentModule.getShareIntent.mockImplementation(async () => {
			throw new Error("app group unavailable");
		});

		await expect(source.getInitialSharedText()).resolves.toBeNull();
	});

	it("プロセスが変われば（＝モジュールを読み直せば）また読める", async () => {
		const first = loadSource();
		givenColdStartShare(SHARE_DATA_URL, textShare("1 回目"));
		await first.getInitialSharedText();

		const relaunched = loadSource();
		givenColdStartShare(SHARE_DATA_URL, textShare("2 回目"));
		await expect(relaunched.getInitialSharedText()).resolves.toBe("2 回目");
	});
});

describe("subscribeSharedText（起動済みのアプリへ来た共有）", () => {
	it("拡張のディープリンクが来たら getShareIntent を呼び、リスナーへ渡す", () => {
		const source = loadSource();
		const listener = jest.fn();
		source.subscribeSharedText(listener);

		mockShareIntentModule.getShareIntent.mockImplementation(async () => {
			emitNativeShare(weburlShare(TIKTOK_URL));
		});
		emitLinkingUrl(SHARE_DATA_URL_WEBURL);

		expect(mockShareIntentModule.getShareIntent).toHaveBeenCalledWith(SHARE_DATA_URL_WEBURL);
		expect(listener).toHaveBeenCalledWith(TIKTOK_URL);
	});

	it("dataUrl= の形をしていないディープリンク（通常のユニバーサルリンク）では何もしない", () => {
		const source = loadSource();
		const listener = jest.fn();
		source.subscribeSharedText(listener);

		emitLinkingUrl("https://app.nanitabeyo.net/ja/spots/123");

		expect(mockShareIntentModule.getShareIntent).not.toHaveBeenCalled();
		expect(listener).not.toHaveBeenCalled();
	});

	it("採用できない共有（画像・動画）はリスナーへ渡さない", () => {
		const source = loadSource();
		const listener = jest.fn();
		source.subscribeSharedText(listener);

		emitNativeShare({ type: "media", files: [{ fileName: "a.jpg" }] });

		expect(listener).not.toHaveBeenCalled();
	});

	it("解除したら以降は呼ばれず、ネイティブと Linking の購読も手放す（リークしない）", () => {
		const source = loadSource();
		const listener = jest.fn();

		const unsubscribe = source.subscribeSharedText(listener);
		expect(mockNativeListeners.size).toBe(1);
		expect(mockLinkingListeners.size).toBe(1);

		unsubscribe();
		expect(mockNativeListeners.size).toBe(0);
		expect(mockLinkingListeners.size).toBe(0);

		emitNativeShare(textShare(TIKTOK_URL));
		expect(listener).not.toHaveBeenCalled();
	});

	it("解除を二重に呼んでも、他の購読者が巻き添えにならない", () => {
		const source = loadSource();
		const first = jest.fn();
		const second = jest.fn();

		const unsubscribeFirst = source.subscribeSharedText(first);
		source.subscribeSharedText(second);
		expect(mockNativeListeners.size).toBe(1); // ネイティブ購読は 1 本を共有する

		unsubscribeFirst();
		unsubscribeFirst();

		emitNativeShare(textShare(TIKTOK_URL));
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledWith(TIKTOK_URL);
		expect(mockNativeListeners.size).toBe(1);
	});

	it("購読と解除を繰り返してもネイティブ・Linking の購読が増えない", () => {
		const source = loadSource();

		for (let i = 0; i < 5; i += 1) {
			const unsubscribe = source.subscribeSharedText(jest.fn());
			expect(mockNativeListeners.size).toBe(1);
			expect(mockLinkingListeners.size).toBe(1);
			unsubscribe();
			expect(mockNativeListeners.size).toBe(0);
			expect(mockLinkingListeners.size).toBe(0);
		}

		expect(mockShareIntentModule.addListener).toHaveBeenCalledTimes(5);
	});
});

// ★ 起動時の共有もアプリ内の共有も、ネイティブからは同じ onChange で届く。
//   両方へ流すと 1 回の共有が 2 回取り込まれる（設計 §3 の «何度も取り込まれる» そのもの）
describe("起動時の共有と購読が二重に流れない", () => {
	it("起動時の 1 本は購読リスナーへ渡らない", async () => {
		const source = loadSource();
		mockInitialUrl = SHARE_DATA_URL;
		mockShareIntentModule.getShareIntent.mockImplementation(async () => {
			emitNativeShare(textShare("この店おいしかった"));
		});

		// useSnsShareIntake と同じ順序: 先に起動時の読み取りを始め、続けて購読する
		const initial = source.getInitialSharedText();
		const listener = jest.fn();
		source.subscribeSharedText(listener);

		await expect(initial).resolves.toBe("この店おいしかった");
		expect(listener).not.toHaveBeenCalled();
	});

	it("起動時の読み取りが終わった «後» に来た共有は購読へ流れる", async () => {
		const source = loadSource();
		givenColdStartShare(SHARE_DATA_URL, textShare("1 回目の共有"));

		const listener = jest.fn();
		source.subscribeSharedText(listener);
		await source.getInitialSharedText();

		mockShareIntentModule.getShareIntent.mockImplementation(async () => {
			emitNativeShare(weburlShare(TIKTOK_URL));
		});
		emitLinkingUrl(SHARE_DATA_URL_WEBURL);

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(TIKTOK_URL);
	});

	it("起動時の待機中に採用できない共有が来ても、待ち続けずに畳む", async () => {
		const source = loadSource();
		mockInitialUrl = SHARE_DATA_URL;
		mockShareIntentModule.getShareIntent.mockImplementation(async () => {
			emitNativeShare({ type: "media", files: [{ fileName: "a.jpg" }] });
		});

		await expect(source.getInitialSharedText()).resolves.toBeNull();
	});
});

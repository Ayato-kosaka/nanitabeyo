/**
 * #1400（親 #1375）PR3: iOS の共有（Share Extension → App Group）の受け取りを固定する。
 *
 * ## 実機が使えないので、ネイティブ境界だけをモックする
 *
 * iOS の受け取りはネイティブ境界が 2 本ある（Android は 1 本）。
 *
 * 1. `ExpoShareIntentModule` … `getShareIntent(url)` / `clearShareIntent(key)` と `onChange`
 * 2. `expo-linking` … 拡張が本体を叩き起こす `nanitabeyo://dataUrl=nanitabeyoShareKey#...` の配達
 *
 * `hasShareIntent()` は iOS では常に `false` を返す（`ExpoShareIntentModule.swift` が
 * `// for Android only` と書いている）ので、この層は **使わない**。代わりに «起動 URL が
 * 拡張の開いたものか» で判定する。ここを差し替えれば実機無しで全部固定できる。
 *
 * ## ここで守っているもの（`sharedTextSource.android.test.ts` と同じ観点）
 * 1. 起動時の共有は **初回だけ返す**（2 回目は `null`、ネイティブも叩かない）
 * 2. 読んだら App Group の保持を**必ずクリアする** — 次の «プロセス» で同じ共有を読まないため
 * 3. text / weburl 以外（画像・ファイル）は無視する
 * 4. URL でない共有テキストは **落とさずそのまま流す**（判定は `parseSnsUrl()` の仕事）
 * 5. 起動時の 1 本が購読側へ **二重に流れない**
 * 6. 購読解除でネイティブと `Linking` の購読を両方手放す（リークしない・二重解除で壊れない）
 *
 * モジュールスコープの状態（`hasReadInitial` / 参照カウント）を検証対象にしているので、
 * テストごとに `jest.resetModules()` して読み直す（`lib/sharedText.test.ts` と同じ作法。
 * テスト専用のリセット関数は生やさない）。
 */

const SCHEME = "nanitabeyo";
const SHARE_KEY = `${SCHEME}ShareKey`;
/** 拡張が `application.open()` する URL（`ShareViewController.swift` の `redirectToHostApp`） */
const WEBURL_REDIRECT = `${SCHEME}://dataUrl=${SHARE_KEY}#weburl`;
const TEXT_REDIRECT = `${SCHEME}://dataUrl=${SHARE_KEY}#text`;

/** ネイティブが `onChange` を配るときに呼ぶリスナー置き場（実機の EventEmitter の代わり） */
const mockNativeListeners = new Set<(event: { value: unknown }) => void>();
/** `Linking.addEventListener("url", ...)` のリスナー置き場 */
const mockLinkingListeners = new Set<(event: { url: string }) => void>();

const mockShareIntentModule = {
	getShareIntent: jest.fn(async (_url: string): Promise<void> => {}),
	clearShareIntent: jest.fn((_key: string): void => {}),
	// iOS では常に false。この層が使っていないことを «呼ばれない» で固定するために置く
	hasShareIntent: jest.fn((_key: string): boolean => false),
	addListener: jest.fn((_eventName: string, listener: (event: { value: unknown }) => void) => {
		mockNativeListeners.add(listener);
		return {
			remove: () => {
				mockNativeListeners.delete(listener);
			},
		};
	}),
};

const mockGetInitialURL = jest.fn(async (): Promise<string | null> => null);

jest.mock("expo-share-intent/build/ExpoShareIntentModule", () => ({
	__esModule: true,
	default: mockShareIntentModule,
}));

jest.mock("expo-linking", () => ({
	__esModule: true,
	getInitialURL: (...args: []) => mockGetInitialURL(...args),
	addEventListener: (_type: string, listener: (event: { url: string }) => void) => {
		mockLinkingListeners.add(listener);
		return {
			remove: () => {
				mockLinkingListeners.delete(listener);
			},
		};
	},
}));

// jest.setup.js の expo-constants モックは `scheme` を持たない（app.config.ts を評価しないため）。
// スキームは «App Group のキー» と «拡張が開く URL» の両方の元なので、ここで明示的に与える
jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: { scheme: SCHEME } },
}));

/** ネイティブから `onChange` が飛んできた状況を作る */
const emitNativeShare = (value: unknown) => {
	for (const listener of [...mockNativeListeners]) listener({ value });
};

/** 拡張が本体を開いた（＝ディープリンクが届いた）状況を作る */
const emitLinkingUrl = (url: string) => {
	for (const listener of [...mockLinkingListeners]) listener({ url });
};

/**
 * jest-expo の既定プラットフォームは ios だが、`sharedTextSource.ts`（web フォールバック）と
 * 取り違えないよう拡張子まで書いて直接読む（android 側のテストと同じ作法）。
 */
const loadSource = () => {
	jest.resetModules();
	return (require("./sharedTextSource.ios") as typeof import("./sharedTextSource.ios")).sharedTextSource;
};

const TIKTOK_URL = "https://www.tiktok.com/@cookpad/video/7261234567890123456";

/** ネイティブが返す JSON 文字列（`ExpoShareIntentModule.swift` の `handleUrl`） */
const weburlPayload = (url: string) => JSON.stringify({ weburls: [{ url, meta: "{}" }], type: "weburl" });
const textPayload = (text: string) => JSON.stringify({ text, type: "text" });

beforeEach(() => {
	mockNativeListeners.clear();
	mockLinkingListeners.clear();
	// clearMocks: true は呼び出し履歴しか消さない。mockReturnValue / mockImplementation は
	// 前のテストのものが残るので、ここで既定へ戻す
	mockShareIntentModule.getShareIntent.mockImplementation(async () => {});
	mockShareIntentModule.clearShareIntent.mockImplementation(() => {});
	mockShareIntentModule.hasShareIntent.mockImplementation(() => false);
	mockGetInitialURL.mockImplementation(async () => null);
});

/** 「共有から起動された」状況。`getShareIntent()` が呼ばれたら `onChange` が飛ぶ */
const givenColdStartShare = (value: unknown, redirectUrl: string = WEBURL_REDIRECT) => {
	mockGetInitialURL.mockImplementation(async () => redirectUrl);
	mockShareIntentModule.getShareIntent.mockImplementation(async () => {
		emitNativeShare(value);
	});
};

describe("getInitialSharedText（コールドスタートの共有）", () => {
	it("共有から起動されたら、その URL を返す", async () => {
		const source = loadSource();
		givenColdStartShare(weburlPayload(TIKTOK_URL));

		await expect(source.getInitialSharedText()).resolves.toBe(TIKTOK_URL);
	});

	// 拡張は「URL を開いて本体を起こす」だけなので、ネイティブへ «その URL» を渡さないと
	// どの App Group のどのキーを読めばよいか決まらない（Android は引数を捨てている）
	it("拡張が開いた URL をそのままネイティブへ渡す", async () => {
		const source = loadSource();
		givenColdStartShare(weburlPayload(TIKTOK_URL));

		await source.getInitialSharedText();

		expect(mockShareIntentModule.getShareIntent).toHaveBeenCalledWith(WEBURL_REDIRECT);
	});

	it("プレーンテキストの共有（#text）も受け取る", async () => {
		const source = loadSource();
		givenColdStartShare(textPayload(TIKTOK_URL), TEXT_REDIRECT);

		await expect(source.getInitialSharedText()).resolves.toBe(TIKTOK_URL);
	});

	// ★ 本題。`getInitialURL()` が «起動時の URL» を返し続ける罠（app/index.tsx:23,72,97 と同じ）
	it("2 回目以降は null を返し、ネイティブを叩かない（同じ共有を 2 回取り込まない）", async () => {
		const source = loadSource();
		givenColdStartShare(weburlPayload(TIKTOK_URL));

		await expect(source.getInitialSharedText()).resolves.toBe(TIKTOK_URL);
		expect(mockShareIntentModule.getShareIntent).toHaveBeenCalledTimes(1);

		await expect(source.getInitialSharedText()).resolves.toBeNull();
		await expect(source.getInitialSharedText()).resolves.toBeNull();
		expect(mockShareIntentModule.getShareIntent).toHaveBeenCalledTimes(1);
		expect(mockGetInitialURL).toHaveBeenCalledTimes(1);
	});

	// JS のフラグはプロセスが変われば消える。App Group を空にしないと «次の起動» で読み直す。
	// iOS の getShareIntent() は Android と違い読むだけで消さないので、ここが唯一の消し口である
	it("読んだら App Group の保持もクリアする", async () => {
		const source = loadSource();
		givenColdStartShare(weburlPayload(TIKTOK_URL));

		await source.getInitialSharedText();

		expect(mockShareIntentModule.clearShareIntent).toHaveBeenCalledTimes(1);
		expect(mockShareIntentModule.clearShareIntent).toHaveBeenCalledWith(SHARE_KEY);
	});

	it("共有以外（ランチャー・ディープリンク）で起動したときはネイティブを叩かずに null", async () => {
		const source = loadSource();
		mockGetInitialURL.mockImplementation(async () => null);

		await expect(source.getInitialSharedText()).resolves.toBeNull();
		expect(mockShareIntentModule.getShareIntent).not.toHaveBeenCalled();
	});

	// App Links / カスタムスキームの通常のディープリンクで «共有» を読みに行ってはいけない
	it.each([
		["App Links", "https://app.nanitabeyo.net/ja-JP/profile"],
		["カスタムスキームの通常リンク", `${SCHEME}:///ja-JP/profile`],
		["OAuth コールバック", `${SCHEME}://auth/callback?code=abc`],
	])("共有と無関係なディープリンクではネイティブを叩かない: %s", async (_label, url) => {
		const source = loadSource();
		mockGetInitialURL.mockImplementation(async () => url);

		await expect(source.getInitialSharedText()).resolves.toBeNull();
		expect(mockShareIntentModule.getShareIntent).not.toHaveBeenCalled();
	});

	// iOS の hasShareIntent() は常に false を返す。これに頼ると共有が丸ごと拾えなくなる
	it("hasShareIntent() には頼らない（iOS では常に false を返すため）", async () => {
		const source = loadSource();
		givenColdStartShare(weburlPayload(TIKTOK_URL));

		await expect(source.getInitialSharedText()).resolves.toBe(TIKTOK_URL);
		expect(mockShareIntentModule.hasShareIntent).not.toHaveBeenCalled();
	});

	it("URL でない共有テキストも落とさずそのまま返す（判定は parseSnsUrl の仕事）", async () => {
		const source = loadSource();
		givenColdStartShare(textPayload("この店おいしかった"), TEXT_REDIRECT);

		await expect(source.getInitialSharedText()).resolves.toBe("この店おいしかった");
	});

	it.each([
		["画像・動画の共有（type: media）", JSON.stringify({ files: [{ fileName: "a.jpg" }], type: "media" })],
		["ファイルの共有（type: file）", JSON.stringify({ files: [{ fileName: "a.pdf" }], type: "file" })],
		["text だが中身が空白だけ", JSON.stringify({ text: "   ", type: "text" })],
		["text が欠けている", JSON.stringify({ type: "text" })],
		["weburl だが weburls が空", JSON.stringify({ weburls: [], type: "weburl" })],
		["JSON として壊れている", "{not json"],
		["value が object でない", 42],
	])("text / weburl 以外は無視する: %s", async (_label, value) => {
		const source = loadSource();
		givenColdStartShare(value);

		await expect(source.getInitialSharedText()).resolves.toBeNull();
	});

	// ネイティブは App Group が読めないと onError だけを投げて onChange を投げない。
	// 待ち続けると起動時の採用機会を握ったままになる
	it("共有で起動されたのにイベントが来なければ、待ち続けずに null で諦める", async () => {
		jest.useFakeTimers();
		try {
			const source = loadSource();
			mockGetInitialURL.mockImplementation(async () => WEBURL_REDIRECT);
			mockShareIntentModule.getShareIntent.mockImplementation(async () => {});

			const pending = source.getInitialSharedText();
			await jest.advanceTimersByTimeAsync(5000);

			await expect(pending).resolves.toBeNull();
		} finally {
			jest.useRealTimers();
		}
	});

	it("getInitialURL が失敗してもアプリを止めない（起動できない方が害が大きい）", async () => {
		const source = loadSource();
		mockGetInitialURL.mockImplementation(async () => {
			throw new Error("linking unavailable");
		});

		await expect(source.getInitialSharedText()).resolves.toBeNull();
	});

	it("getShareIntent が失敗しても null で畳む", async () => {
		const source = loadSource();
		mockGetInitialURL.mockImplementation(async () => WEBURL_REDIRECT);
		mockShareIntentModule.getShareIntent.mockImplementation(async () => {
			throw new Error("app group unavailable");
		});

		await expect(source.getInitialSharedText()).resolves.toBeNull();
	});

	it("プロセスが変われば（＝モジュールを読み直せば）また読める", async () => {
		const first = loadSource();
		givenColdStartShare(weburlPayload(TIKTOK_URL));
		await first.getInitialSharedText();

		const relaunched = loadSource();
		givenColdStartShare(weburlPayload(TIKTOK_URL));
		await expect(relaunched.getInitialSharedText()).resolves.toBe(TIKTOK_URL);
	});
});

describe("subscribeSharedText（起動済みのアプリへ来た共有）", () => {
	it("拡張がアプリを開いたらネイティブへ読ませ、届いた値をリスナーへ渡す", async () => {
		const source = loadSource();
		const listener = jest.fn();
		source.subscribeSharedText(listener);

		mockShareIntentModule.getShareIntent.mockImplementation(async () => {
			emitNativeShare(weburlPayload(TIKTOK_URL));
		});
		emitLinkingUrl(WEBURL_REDIRECT);
		await Promise.resolve();

		expect(mockShareIntentModule.getShareIntent).toHaveBeenCalledWith(WEBURL_REDIRECT);
		expect(listener).toHaveBeenCalledWith(TIKTOK_URL);
	});

	// ★ 拡張が開く URL は毎回まったく同じ文字列である（変わるのは App Group の中身だけ）。
	//   URL で重複排除すると 2 回目以降の共有が全部消える
	it("同じ URL で何度共有されても、そのたびに取り込む", async () => {
		const source = loadSource();
		const listener = jest.fn();
		source.subscribeSharedText(listener);

		mockShareIntentModule.getShareIntent.mockImplementation(async () => {
			emitNativeShare(weburlPayload(TIKTOK_URL));
		});
		emitLinkingUrl(WEBURL_REDIRECT);
		await Promise.resolve();

		const second = "https://www.youtube.com/shorts/dQw4w9WgXcQ";
		mockShareIntentModule.getShareIntent.mockImplementation(async () => {
			emitNativeShare(weburlPayload(second));
		});
		emitLinkingUrl(WEBURL_REDIRECT);
		await Promise.resolve();

		expect(listener).toHaveBeenCalledTimes(2);
		expect(listener).toHaveBeenNthCalledWith(1, TIKTOK_URL);
		expect(listener).toHaveBeenNthCalledWith(2, second);
	});

	// iOS の getShareIntent() は読むだけで消さないので、購読経路でも消し口が要る
	it("起動中に受け取った共有も App Group をクリアする", async () => {
		const source = loadSource();
		source.subscribeSharedText(jest.fn());

		emitNativeShare(weburlPayload(TIKTOK_URL));

		expect(mockShareIntentModule.clearShareIntent).toHaveBeenCalledWith(SHARE_KEY);
	});

	it("共有と無関係なディープリンクではネイティブを叩かない", async () => {
		const source = loadSource();
		source.subscribeSharedText(jest.fn());

		emitLinkingUrl("https://app.nanitabeyo.net/ja-JP/profile");
		await Promise.resolve();

		expect(mockShareIntentModule.getShareIntent).not.toHaveBeenCalled();
	});

	it("text / weburl 以外はリスナーへ渡さない", () => {
		const source = loadSource();
		const listener = jest.fn();
		source.subscribeSharedText(listener);

		emitNativeShare(JSON.stringify({ files: [{ fileName: "a.jpg" }], type: "media" }));

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

		emitNativeShare(weburlPayload(TIKTOK_URL));
		expect(listener).not.toHaveBeenCalled();
	});

	it("解除を二重に呼んでも、他の購読者が巻き添えにならない", () => {
		const source = loadSource();
		const first = jest.fn();
		const second = jest.fn();

		const unsubscribeFirst = source.subscribeSharedText(first);
		source.subscribeSharedText(second);
		expect(mockNativeListeners.size).toBe(1); // ネイティブ購読は 1 本を共有する
		expect(mockLinkingListeners.size).toBe(1);

		unsubscribeFirst();
		unsubscribeFirst();

		emitNativeShare(weburlPayload(TIKTOK_URL));
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledWith(TIKTOK_URL);
		expect(mockNativeListeners.size).toBe(1);
		expect(mockLinkingListeners.size).toBe(1);
	});

	it("購読と解除を繰り返してもネイティブの購読が増えない", () => {
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
		mockGetInitialURL.mockImplementation(async () => WEBURL_REDIRECT);
		mockShareIntentModule.getShareIntent.mockImplementation(async () => {
			emitNativeShare(weburlPayload(TIKTOK_URL));
		});

		// useSnsShareIntake と同じ順序: 先に起動時の読み取りを始め、続けて購読する
		const initial = source.getInitialSharedText();
		const listener = jest.fn();
		source.subscribeSharedText(listener);

		await expect(initial).resolves.toBe(TIKTOK_URL);
		expect(listener).not.toHaveBeenCalled();
	});

	// iOS はコールドスタートでも url イベントが «起動 URL と同じもの» で飛びうる。
	// ここで重ねて叩くと同じ共有が 2 回 onChange で返る
	it("起動時の読み取り中に同じ URL の url イベントが来ても、ネイティブを二重に叩かない", async () => {
		const source = loadSource();
		mockGetInitialURL.mockImplementation(async () => WEBURL_REDIRECT);
		mockShareIntentModule.getShareIntent.mockImplementation(async () => {
			emitLinkingUrl(WEBURL_REDIRECT); // 読み取りの最中に配達される
			emitNativeShare(weburlPayload(TIKTOK_URL));
		});

		const listener = jest.fn();
		const initial = source.getInitialSharedText();
		source.subscribeSharedText(listener);

		await expect(initial).resolves.toBe(TIKTOK_URL);
		expect(mockShareIntentModule.getShareIntent).toHaveBeenCalledTimes(1);
		expect(listener).not.toHaveBeenCalled();
	});

	it("起動時の読み取りが終わった «後» に来た共有は購読へ流れる", async () => {
		const source = loadSource();
		givenColdStartShare(weburlPayload(TIKTOK_URL));

		const listener = jest.fn();
		source.subscribeSharedText(listener);
		await source.getInitialSharedText();

		const nextShare = "https://www.youtube.com/shorts/dQw4w9WgXcQ";
		mockShareIntentModule.getShareIntent.mockImplementation(async () => {
			emitNativeShare(weburlPayload(nextShare));
		});
		emitLinkingUrl(WEBURL_REDIRECT);
		await Promise.resolve();

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(nextShare);
	});

	it("起動時の待機中に扱えない共有が来ても、待ち続けずに畳む", async () => {
		const source = loadSource();
		mockGetInitialURL.mockImplementation(async () => WEBURL_REDIRECT);
		mockShareIntentModule.getShareIntent.mockImplementation(async () => {
			emitNativeShare(JSON.stringify({ files: [{ fileName: "a.jpg" }], type: "media" }));
		});

		await expect(source.getInitialSharedText()).resolves.toBeNull();
	});
});

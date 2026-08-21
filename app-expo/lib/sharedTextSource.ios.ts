// lib/sharedTextSource.ios.ts
//
// #1400（親 #1375）PR3: iOS の共有（Share Extension + App Group）を受け取る実装。
//
// ## Metro が拡張子で選ぶ。`sharedTextSource.ts` は消さないこと
//
// iOS では **このファイル**が `lib/sharedTextSource` として解決される。Android は
// `sharedTextSource.android.ts` が別に担当しており、両者の対称性は `sharedTextSource.android.ts`
// の doc コメントの通り。
//
// ## #1472（App Group）が前提
//
// この実装は Apple Developer 側で登録済みの App Group（`group.com.nanitabeyo`）と、
// 拡張の bundle identifier（`com.nanitabeyo.ShareExtension`）を前提にしている。値は
// `app.config.ts` の `expo-share-intent` plugin 設定（`iosAppGroupIdentifier` /
// `iosShareExtensionBundleIdentifier`）に集約してあり、ここでは直接参照しない
// （拡張が書き込む UserDefaults の suite 名はネイティブ側の `AppGroupIdentifier`
// Info.plist キー経由で解決されるため、JS 側は App Group の識別子そのものを知らなくてよい）。
//
// ## iOS は Android と «届き方» がまったく違う
//
// Android の `hasShareIntent()` / `getShareIntent(key)` はネイティブの Activity Intent を
// 直接読むだけで完結するが、**iOS の `hasShareIntent()` は常に `false` を返す**
// （`ExpoShareIntentModule.swift` の `Function("hasShareIntent")` に "for Android only" と
// 明記されている）。iOS の Share Extension は共有データを App Group の `UserDefaults` へ書いたあと、
// ホストアプリを **ディープリンク**（`<scheme>://dataUrl=<scheme>ShareKey#text` /
// `...#weburl`）で開き直すことでしか通知できない。つまり iOS の «届いたかどうか» の判定は
// Android の boolean フラグではなく、**このディープリンクが来たかどうか**そのものになる。
//
// - 起動のきっかけ … `Linking.getInitialURL()` がこの形の URL を返したとき
// - 起動済みへの共有 … `Linking.addEventListener("url", ...)` がこの形の URL を配ったとき
//
// どちらの経路でも、URL を検出したら `ExpoShareIntentModule.getShareIntent(url)` を呼ぶ。
// これがネイティブ側で App Group の `UserDefaults` から値を読み、`onChange` イベントとして
// 返してくる（Android の `getShareIntent(key)` と同じ `onChange` 経由の受け口に合流する）。
//
// ## `Linking.getInitialURL()` も «起動時の値» を返し続ける（同じ罠、対処も同じ）
//
// `app/index.tsx` の «起動時 URL» の罠と同一の性質を持つため、起動時の 1 回だけを
// `hasReadInitial` で使い切る作りは Android と揃えてある。加えてネイティブ側の
// `UserDefaults` も `clearShareIntent()` で必ず空にする（消さないと «次の起動» で
// 同じ共有をもう一度読む。`lib/sharedText.ts` の doc コメントと同じ理由）。
//
// ## `onChange` の payload の形は Android と 2 点だけ違う
//
// 1. 文字列化された JSON で届く（`ExpoShareIntentModule.swift` の `toJSON()`）。
//    Android は object のまま届くため、両方を受ける `parseNativeValue()` は
//    Android 側の実装がすでに想定して書いてある（`sharedTextSource.android.ts` の
//    doc コメント参照）
// 2. **プレーンテキスト共有（`type: "text"`）に加えて、URL 共有（`type: "weburl"`）が来る。**
//    SNS アプリの共有シートは「投稿へのリンク」を `public.url` として渡すことが多く
//    （`ShareExtensionViewController.swift` の `handleUrl` / `NSExtensionActivationRule` に
//    `NSExtensionActivationSupportsWebURLWithMaxCount` を含めているのはこのため）、
//    ここを見ないと **iOS の主要経路を落とす**。`weburls[0].url` を採用する
//
// ⚠️ **URL かどうかの判定はここでは行わない。** Android と同じく `parseSnsUrl()` に一本化されて
// いるため（`lib/snsShareIntake.ts`）、weburl 以外のプレーンテキストもそのまま流す。

import Constants from "expo-constants";
import * as Linking from "expo-linking";
import ShareIntentModule from "expo-share-intent/build/ExpoShareIntentModule";
import type { ChangeEventPayload } from "expo-share-intent/build/ExpoShareIntentModule.types";

import type { SharedTextListener, SharedTextSource } from "./sharedText";

/**
 * ディープリンクのスキーム。`app.config.ts` の `scheme` と一致する必要がある
 * （拡張側は `withIosShareExtensionXcodeTarget` がビルド時に同じ値を焼き込む）。
 *
 * `expo-share-intent` 自身の `getScheme()`（`node_modules/expo-share-intent/build/utils.js`）と
 * 同じ解決順序にしてある: 複数 scheme が配列で来る場合は先頭を使う。
 */
const getScheme = (): string | null => {
	const scheme = Constants.expoConfig?.scheme;
	if (Array.isArray(scheme)) return scheme[0] ?? null;
	return scheme ?? null;
};

/** 拡張がホストアプリを開き直すときの URL プレフィックス（`ShareExtensionViewController.swift` 参照） */
const getShareDataUrlPrefix = (): string | null => {
	const scheme = getScheme();
	return scheme ? `${scheme}://dataUrl=` : null;
};

const isShareDataUrl = (url: string | null | undefined): url is string => {
	const prefix = getShareDataUrlPrefix();
	return typeof url === "string" && prefix !== null && url.startsWith(prefix);
};

/**
 * 拡張が `UserDefaults` へ書き込むキー。`ShareExtensionViewController.swift` の
 * `sharedKey = "<SCHEME>ShareKey"` と一致させる必要がある（`clearShareIntent()` に渡す）。
 */
const getShareKey = (): string | null => {
	const scheme = getScheme();
	return scheme ? `${scheme}ShareKey` : null;
};

/**
 * 「共有がある」と言われたのにイベントが来ないときに諦めるまでの時間。
 * Android 実装（`sharedTextSource.android.ts`）と同じ値・同じ理由。
 */
const INITIAL_SHARE_TIMEOUT_MS = 2000;

/** `onChange` で届くネイティブの値。text/weburl の 2 系統がある（上の doc コメント参照） */
type NativeShareIntentValue = {
	text?: string | null;
	type?: string | null;
	weburls?: { url?: string | null; meta?: string | null }[] | null;
};

/**
 * ネイティブの値を素直な object に均す。iOS は JSON 文字列で送ってくる
 * （`ExpoShareIntentModule.swift` の `toJSON()`）。Android の object もそのまま受けられるようにして
 * あるのは、Android 側の実装と対称にしておくため（将来どちらかの形式が変わっても壊れない）。
 */
const parseNativeValue = (value: unknown): NativeShareIntentValue | null => {
	if (typeof value === "string") {
		try {
			const parsed: unknown = JSON.parse(value);
			return typeof parsed === "object" && parsed !== null ? (parsed as NativeShareIntentValue) : null;
		} catch {
			return null;
		}
	}
	return typeof value === "object" && value !== null ? (value as NativeShareIntentValue) : null;
};

/**
 * 共有として採用するテキストを取り出す。採用できなければ `null`。
 *
 * `type: "weburl"` は `weburls[0].url` を、`type: "text"` は `text` を採用する。
 * それ以外（`media` / `file` / 判定不能）は無視する — 画像・動画の共有はこの層の対象外
 * （設計 §2、Android と同じ判断）。
 */
const extractSharedText = (value: unknown): string | null => {
	const parsed = parseNativeValue(value);
	if (!parsed) return null;

	if (parsed.type === "weburl") {
		const url = parsed.weburls?.[0]?.url;
		return typeof url === "string" && url.trim().length > 0 ? url : null;
	}

	if (parsed.type === "text") {
		return typeof parsed.text === "string" && parsed.text.trim().length > 0 ? parsed.text : null;
	}

	return null;
};

/** 起動済みのアプリへ来た共有を受け取るリスナー */
const listeners = new Set<SharedTextListener>();

/**
 * ネイティブの `onChange` 購読と、ディープリンクを拾う `Linking` 購読。
 * 利用者（起動時の待機 + 各リスナー）が居る間だけ、両方をまとめて張る。
 */
let nativeSubscription: { remove: () => void } | null = null;
let linkingSubscription: { remove: () => void } | null = null;
let nativeRefCount = 0;

/** 起動時の共有を待っている間だけ立つ。ここに値が入っている間のイベントは購読側へ流さない */
let initialCapture: { settle: (text: string | null) => void } | null = null;

/** 起動時の共有を «プロセスにつき 1 回» に閉じるフラグ（`lib/sharedText.ts` と同じ規律） */
let hasReadInitial = false;

const onNativeChange = (event: ChangeEventPayload) => {
	const text = extractSharedText(event?.value as unknown);

	if (initialCapture) {
		// 扱えない共有（`text === null`）でも «起動時の待機» はここで畳む。
		// 畳まないと INITIAL_SHARE_TIMEOUT_MS を無駄に待つ
		initialCapture.settle(text);
		return;
	}

	if (text === null) return;
	// 反復中に unsubscribe されても壊れないようスナップショットを取る
	for (const listener of [...listeners]) listener(text);
};

/**
 * ディープリンクを検出したら、ネイティブへ「App Group から読んで」と伝える。
 *
 * ⚠️ `expo-share-intent` 同梱の型定義（`ExpoShareIntentModule.d.ts`）は `getShareIntent` を
 * 同期 `string` 返しと誤って宣言している（実体は Swift 側の `AsyncFunction`。上の doc コメント
 * 参照）。`.catch()` の直接呼び出しは型エラーになるため、Android 実装（`getInitialSharedText`）と
 * 同じ `await` + `try/catch` の形に揃える。
 */
const onLinkingUrl = ({ url }: { url: string }) => {
	if (!isShareDataUrl(url)) return;
	void (async () => {
		try {
			await ShareIntentModule?.getShareIntent(url);
		} catch {
			// ここで投げてもアプリを止める理由が無い。onChange が来ないだけで諦められる
		}
	})();
};

const retainNative = () => {
	nativeRefCount += 1;
	if (nativeRefCount > 1) return;
	nativeSubscription = ShareIntentModule?.addListener("onChange", onNativeChange) ?? null;
	linkingSubscription = Linking.addEventListener("url", onLinkingUrl);
};

const releaseNative = () => {
	nativeRefCount = Math.max(0, nativeRefCount - 1);
	if (nativeRefCount > 0) return;
	nativeSubscription?.remove();
	nativeSubscription = null;
	linkingSubscription?.remove();
	linkingSubscription = null;
};

/** ネイティブ側の `UserDefaults` の保持を消す。次の «プロセス» で同じ共有を読まないため */
const clearNativeShareIntent = () => {
	const key = getShareKey();
	if (!key) return;
	try {
		ShareIntentModule?.clearShareIntent(key);
	} catch {
		// 消せなくても取り込み自体は成立している。ここで投げてアプリを止める方が害が大きい
	}
};

/**
 * 起動のきっかけになった共有テキスト。無ければ `null`。
 *
 * Android と異なり、起動時の共有は `hasShareIntent()`（常に `false`）では判定できないため、
 * `Linking.getInitialURL()` が拡張のディープリンク形式かどうかで判定する。
 * 「先にリスナーを張る → `getShareIntent(url)` を呼ぶ → 最初に来たイベントを採用する」という
 * 順序は Android と同じ（順序を入れ替えるとイベントを取りこぼす）。
 */
const getInitialSharedText = async (): Promise<string | null> => {
	// ⚠️ await の «前» に立てること（`consumeInitialSharedText()` と同じ理由）
	if (hasReadInitial) return null;
	hasReadInitial = true;

	const nativeModule = ShareIntentModule;
	// dev client を作り直していない・Expo Go・web バンドルを iOS で読んだ、等では null になる
	if (!nativeModule) return null;

	let initialUrl: string | null = null;
	try {
		initialUrl = await Linking.getInitialURL();
	} catch {
		return null;
	}
	// 共有以外（ランチャー・ユニバーサルリンク・カスタムスキーム）で起動したときはここで終わる
	if (!isShareDataUrl(initialUrl)) return null;

	retainNative();
	try {
		return await new Promise<string | null>((resolve) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const settle = (text: string | null) => {
				if (initialCapture === capture) initialCapture = null;
				if (timer !== undefined) clearTimeout(timer);
				resolve(text);
			};
			const capture = { settle };

			initialCapture = capture;
			timer = setTimeout(() => settle(null), INITIAL_SHARE_TIMEOUT_MS);

			void (async () => {
				try {
					await nativeModule.getShareIntent(initialUrl);
				} catch {
					settle(null);
				}
			})();
		});
	} finally {
		releaseNative();
		clearNativeShareIntent();
	}
};

/**
 * 起動済みのアプリへ来た共有を受け取る。戻り値は購読解除関数。
 *
 * 解除で必ずネイティブの購読と `Linking` の購読も手放す（最後の 1 人が抜けたら `remove()`）。
 * 二重に呼ばれても参照カウントがずれないようにしてある — `useSnsShareIntake` の
 * cleanup は React の再実行で複数回走りうる。
 */
const subscribeSharedText = (listener: SharedTextListener): (() => void) => {
	listeners.add(listener);
	retainNative();

	let released = false;
	return () => {
		if (released) return;
		released = true;
		listeners.delete(listener);
		releaseNative();
	};
};

/** iOS の受け取り口。`lib/sharedTextSource.ts` の «何も来ない» 実装を置き換える */
export const sharedTextSource: SharedTextSource = {
	getInitialSharedText,
	subscribeSharedText,
};

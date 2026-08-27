// lib/sharedTextSource.ios.ts
//
// #1400（親 #1375）PR3: iOS の共有シート（Share Extension）から text / URL を受け取る実装。
//
// ## Metro が拡張子で選ぶ。`sharedTextSource.ts` / `.android.ts` は消さないこと
//
// iOS では **このファイル**が `lib/sharedTextSource` として解決される。Android は PR2 の
// `sharedTextSource.android.ts`、web は `sharedTextSource.ts` の「何も来ない」実装のままである。
// 分岐と «起動時の値» の罠の対処は PR1 が `lib/sharedText.ts` / `lib/snsShareIntake.ts` に
// 閉じているので、ここでやり直さない。
//
// ## 手段は PR2 と同じ A（`expo-share-intent@5.1.1`）。iOS は **plugin が必須**
//
// Share Extension は «アプリ本体とは別の Xcode ターゲット» なので、`ios/` をコミットしない
// CNG のこのリポジトリでは plugin にターゲットごと生成させるしかない。`app.config.ts` へ
// `["expo-share-intent", { disableAndroid: true, ... }]` を足してあり、Android の intent-filter は
// 引き続き PR2 の `android.intentFilters` が担当する（plugin にも生やさせると二重になる）。
//
// PR2 の申し送りは「iOS 側は `patch-package` による xcode パッチが要る（README の Installation）」
// だったが、**5.1.1 では要らなかった**。実測は以下。
//
// | 確かめたこと | 実測値 |
// | --- | --- |
// | `expo prebuild --platform ios`（`ios/` を消してから） | patch 無しで **成功**。`[expo-share-intent] Successfully created ShareExtension target with files` |
// | 生成されたターゲット | `productType = "com.apple.product-type.app-extension"` の `ShareExtension` が増え、本体へ `PBXTargetDependency` と `PBXCopyFilesBuildPhase (dstSubfolderSpec = 13 = PlugIns)` が入る＝**.appex が埋め込まれる** |
// | 2 回目の prebuild（`ios/` を残したまま） | `ShareExtension group already exists in project. Skipping…` で **成功**（README FAQ の «Config sync failed» は再現せず） |
// | パッチの現存 | README が指す `example/basic/patches/xcode+3.0.1.patch` は **upstream の main から削除済み**（リポジトリツリーに patch ファイルが 1 つも無い）。README の Installation が古い |
// | 代わりに何が入ったか | plugin 側の `withIosShareExtensionXcodeTarget.js` が «WORK AROUND for addTarget BUG (from OneSignal)»（`PBXTargetDependency` / `PBXContainerItemProxy` を先に空で用意する）を自前で持っている。かつてパッチが埋めていた穴がライブラリ内へ移った |
//
// ## ネイティブ境界が Android と違う。ここが実装の本体である
//
// 同じ `ExpoShareIntentModule` を使うが、iOS の作りは Android と別物なので素直に移植できない。
//
// | | Android | iOS |
// | --- | --- | --- |
// | 「共有で起動されたか」 | `hasShareIntent()` が答える | **常に `false`**（`ExpoShareIntentModule.swift` の `Function("hasShareIntent")` は `// for Android only` と書いて `false` を返すだけ）。使えない |
// | 共有の受け渡し | プロセス内（`ExpoShareIntentSingleton.intent`） | **App Group の `UserDefaults`**。拡張が書き、本体が読む |
// | 本体の起こし方 | `ACTION_SEND` で Activity ごと起動 | 拡張が `nanitabeyo://dataUrl=nanitabeyoShareKey#weburl` を `application.open()` する＝**ただのディープリンク** |
// | `getShareIntent()` の引数 | 捨てられる | **その URL 自体**。`url.fragment` で種別、`url.host` の `=` 以降で `UserDefaults` のキーを決める |
// | `onChange` の `value` | Map | **JSON 文字列** |
//
// つまり iOS で «共有が来た» を知る唯一の手段は `expo-linking` である。起動時は
// `Linking.getInitialURL()`、起動済みなら `url` イベント。そこで受けた URL を
// `getShareIntent(url)` へ渡すと、ネイティブが App Group を読んで `onChange` を投げ返す。
//
// ## 同じ共有を 2 回流さないための構造（Android と同じ 3 段）
//
// 1. **ネイティブ側で消す** … iOS の `getShareIntent()` は App Group を読むだけで**消さない**
//    （Android は読んだ直後に singleton を `null` にする）。消さないと同じ値が残り続けるので、
//    値を受け取った側が `clearShareIntent("nanitabeyoShareKey")` を必ず呼ぶ。起動時の 1 本は
//    `readShareIntent()` の `finally`、起動中の共有は `onNativeChange` が担当する
// 2. **このモジュールで «起動時の 1 回» を使い切る** … `hasReadInitial` はモジュールスコープ、
//    つまりプロセス寿命。`Linking.getInitialURL()` は «起動時の URL» を返し続ける
//    （`app/index.tsx:23,72,97` に既知の罠として記録されている）ので、これが無いと
//    画面が再マウントされるたびに同じ共有を読む
// 3. **起動時の 1 本を購読側へ流さない** … 起動時の共有もアプリ内の共有も、ネイティブからは
//    同じ `onChange` で届く。待機中（`initialCapture` がある間）のイベントは «起動時の共有» として
//    確定させ、購読リスナーへは渡さない。両方へ流すと 1 回の共有が 2 回取り込まれる
//
// ⚠️ **URL 文字列で重複排除してはいけない。** 拡張が投げてくる URL は毎回まったく同じ
// （`nanitabeyo://dataUrl=nanitabeyoShareKey#weburl`）で、変わるのは App Group の中身だけである。
// 「さっきと同じ URL だから捨てる」を入れると 2 回目以降の共有が全部消える。
//
// ⚠️ 残る穴（正直に書く）: App Group が読めない（capability 未付与・profile 不一致）ときの
// ネイティブは `onError` を投げて `onChange` を投げない。この層はそれを購読していないので、
// 起動時の読み取りは `INITIAL_SHARE_TIMEOUT_MS` だけ待って黙って `null` になる
// （＝「共有したのに何も起きない」に見える）。Xcode の device log に
// `Cannot retreive appGroupIdentifier` / `appGroupIdentifier is nil` が出るかどうかが切り分けの目印。

import Constants from "expo-constants";
import * as Linking from "expo-linking";
import ShareIntentModule from "expo-share-intent/build/ExpoShareIntentModule";
import type { ChangeEventPayload } from "expo-share-intent/build/ExpoShareIntentModule.types";

import type { SharedTextListener, SharedTextSource } from "./sharedText";

/**
 * 「共有がある」と言われたのにイベントが来ないときに諦めるまでの時間。
 *
 * 上限を置かないと `consumeInitialSharedText()` の await が永久に返らず、
 * **起動時の採用機会を握ったまま**になる。Android 実装と同じ値にしてある。
 */
const INITIAL_SHARE_TIMEOUT_MS = 2000;

/**
 * アプリのカスタムスキーム。`app.config.ts` の `scheme` がそのまま入る。
 *
 * ⚠️ **prebuild 時に生成される `ios/ShareExtension/ShareViewController.swift` と
 * 同じ値でなければならない。** 拡張側は plugin が `<SCHEME>` を置換して
 * `shareProtocol` / `sharedKey = "<SCHEME>ShareKey"` に焼き込む（生成物で確認済み:
 * `shareProtocol = "nanitabeyo"` / `sharedKey = "nanitabeyoShareKey"`）。その元も同じ
 * `app.config.ts` の `scheme` なので、ここを `Constants.expoConfig.scheme` から引く限りずれない。
 * 定数で持つと `scheme` を変えたときに片方だけ変わって «共有が無言で消える» になる。
 *
 * モジュール読み込み時ではなく呼び出しのたびに読むのは、`Constants` の解決が
 * import 順に依存しないようにするため。
 */
const getScheme = (): string | null => {
	const scheme = Constants.expoConfig?.scheme;
	const resolved = Array.isArray(scheme) ? scheme[0] : scheme;
	return typeof resolved === "string" && resolved.length > 0 ? resolved : null;
};

/**
 * App Group の `UserDefaults` に共有が置かれるキー（`<SCHEME>ShareKey`）。
 * `clearShareIntent()` へ渡す値であり、これがずれると **消したつもりで消えていない**。
 */
const getShareExtensionKey = (): string | null => {
	const scheme = getScheme();
	return scheme ? `${scheme}ShareKey` : null;
};

/**
 * 拡張が本体を叩き起こすために開く URL か。
 *
 * `nanitabeyo://dataUrl=<key>#<type>` の形（`ShareViewController.swift` の `redirectToHostApp`）。
 * ここで絞らないと、App Links や OAuth コールバックのような **共有と無関係なディープリンクでも
 * ネイティブを叩く**ことになる。
 */
const isShareRedirectUrl = (url: string | null | undefined): url is string => {
	const scheme = getScheme();
	return !!scheme && typeof url === "string" && url.includes(`${scheme}://dataUrl=`);
};

/** `onChange` で届くネイティブの値（iOS は JSON 文字列で来る） */
type NativeShareIntentValue = {
	text?: string | null;
	weburls?: { url?: string | null }[] | null;
	type?: string | null;
};

/**
 * ネイティブの値を素直な object に均す。
 *
 * iOS の `ExpoShareIntentModule.swift` は JSON 文字列を送ってくる（`ShareIntentText.toJSON()` /
 * `"{ \"weburls\": ... }"` の手組み）。ライブラリ側の `parseShareIntent()` も
 * 文字列と object の両方を受けるので、ここも両方受けておく。
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

/** 空白だけの文字列を弾いて採用する。OS から来た生の値は trim しない */
const acceptText = (text: unknown): string | null =>
	typeof text === "string" && text.trim().length > 0 ? text : null;

/**
 * 共有として採用するテキストを取り出す。採用できなければ `null`。
 *
 * ## 通すのは `text` と `weburl` の 2 種類（Android の `type: "text"` 相当）
 *
 * iOS の共有は Android より種別が細かい。`ShareViewController` は共有された item の型を見て
 * `#text` か `#weburl` を選び、ネイティブは種別ごとに別の形の JSON を返す。
 *
 * | `type` | 中身 | 出どころ |
 * | --- | --- | --- |
 * | `"text"` | `{ text }` | `public.text`（YouTube の «本文に URL を含む共有» など） |
 * | `"weburl"` | `{ weburls: [{ url, meta }] }` | `public.url` と Safari の web ページ（preprocessor が `baseURI` を返す） |
 * | `"media"` / `"file"` | `{ files: [...] }` | 画像・動画・ファイル。**扱えないので捨てる** |
 *
 * `iosActivationRules` を WebURL / WebPage / Text に絞ってあるので media・file は共有シートに
 * 出ないはずだが、ここで落とさないと取り込み確認画面が «URL の無い共有» で開く。
 *
 * ⚠️ **URL かどうかはここでは見ない。** 判定は `parseSnsUrl()` に一本化されており
 * （`lib/snsShareIntake.ts` の doc コメント）、URL でない共有テキストは «対応 provider の説明»
 * へ進むのが設計上の正しい行き先である（設計 §6 R-4）。ここで捨てると «共有したのに何も起きない» に戻る。
 */
const extractSharedText = (value: unknown): string | null => {
	const parsed = parseNativeValue(value);
	if (!parsed) return null;

	if (parsed.type === "text") return acceptText(parsed.text);
	if (parsed.type === "weburl") {
		// `weburls[0].url` が本命。`text` を見るのは、ネイティブが fragment を
		// そのまま種別にする経路（`ShareIntentText(text:type:)`）で来たときのため
		const fromWebUrls = Array.isArray(parsed.weburls) ? acceptText(parsed.weburls[0]?.url) : null;
		return fromWebUrls ?? acceptText(parsed.text);
	}
	return null;
};

/** 起動済みのアプリへ来た共有を受け取るリスナー */
const listeners = new Set<SharedTextListener>();

/**
 * ネイティブの `onChange` 購読と、拡張からのディープリンク（`url`）購読。
 * 利用者（起動時の待機 + 各リスナー）が居る間だけ張る。
 */
let nativeSubscription: { remove: () => void } | null = null;
let linkingSubscription: { remove: () => void } | null = null;
let nativeRefCount = 0;

/** 起動時の共有を待っている間だけ立つ。ここに値が入っている間のイベントは購読側へ流さない */
let initialCapture: { settle: (text: string | null) => void } | null = null;

/** 起動時の共有を «プロセスにつき 1 回» に閉じるフラグ（`lib/sharedText.ts` と同じ規律） */
let hasReadInitial = false;

/**
 * App Group に残っている共有を空にする。
 *
 * iOS の `getShareIntent()` は読むだけで消さない。これを省くと、アプリを完全に終了して
 * 起動し直した «次のプロセス» で同じ共有をもう一度読む（`lib/sharedText.ts` の警告）。
 */
const clearNativeShareIntent = () => {
	const key = getShareExtensionKey();
	if (!key) return;
	try {
		ShareIntentModule?.clearShareIntent(key);
	} catch {
		// 消せなくても取り込み自体は成立している。ここで投げてアプリを止める方が害が大きい
	}
};

const onNativeChange = (event: ChangeEventPayload) => {
	const text = extractSharedText(event?.value as unknown);

	if (initialCapture) {
		// 扱えない共有（`text === null`）でも «起動時の待機» はここで畳む。
		// 畳まないと INITIAL_SHARE_TIMEOUT_MS を無駄に待つ。
		// App Group のクリアは `readShareIntent()` の finally が担当する
		initialCapture.settle(text);
		return;
	}

	// 起動済みのアプリへ来た共有。読み終えたので App Group を空にする（扱えない種別でも消す）
	clearNativeShareIntent();

	if (text === null) return;
	// 反復中に unsubscribe されても壊れないようスナップショットを取る
	for (const listener of [...listeners]) listener(text);
};

/**
 * 拡張が開いたディープリンクを受けて、ネイティブに App Group を読ませる。
 *
 * 値そのものは `onChange` で返ってくるので、ここでは «読ませる» だけでよい。
 */
const onLinkingUrl = ({ url }: { url: string }) => {
	if (!isShareRedirectUrl(url)) return;
	// 起動時の読み取りが進行中なら、その 1 本が同じ共有を取りに行っている。
	// ここで重ねて叩くと同じ共有が 2 回 `onChange` で返り、二重に取り込まれる
	if (initialCapture) return;

	const nativeModule = ShareIntentModule;
	if (!nativeModule) return;
	void (async () => {
		try {
			await nativeModule.getShareIntent(url);
		} catch {
			// 読めなければ何も起きない。共有が消えるだけでアプリは動き続ける
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

/**
 * 拡張が開いた URL をネイティブに読ませ、`onChange` で返ってくる 1 本を受け取る。
 *
 * 「先にリスナーを張る → `getShareIntent()` を呼ぶ → 最初に来たイベントを採用する」
 * という順序で 1 本だけ受け取る。順序を入れ替えるとイベントを取りこぼす。
 */
const readShareIntent = async (
	nativeModule: NonNullable<typeof ShareIntentModule>,
	url: string,
): Promise<string | null> => {
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
					await nativeModule.getShareIntent(url);
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
 * 起動のきっかけになった共有テキスト。無ければ `null`。
 *
 * Android と違い `hasShareIntent()` が使えない（iOS では常に `false`）ので、
 * 起動 URL が «拡張が開いたもの» かどうかで判定する。
 */
const getInitialSharedText = async (): Promise<string | null> => {
	// ⚠️ await の «前» に立てること（`consumeInitialSharedText()` と同じ理由）
	if (hasReadInitial) return null;
	hasReadInitial = true;

	// dev client を作り直していない・Expo Go・web バンドルを iOS で読んだ、等では null になる
	const nativeModule = ShareIntentModule;
	if (!nativeModule) return null;

	let initialUrl: string | null = null;
	try {
		initialUrl = await Linking.getInitialURL();
	} catch {
		return null;
	}

	// 共有以外（ランチャー・ディープリンク・OAuth コールバック）で起動したときはここで終わる
	if (!isShareRedirectUrl(initialUrl)) return null;

	return await readShareIntent(nativeModule, initialUrl);
};

/**
 * 起動済みのアプリへ来た共有を受け取る。戻り値は購読解除関数。
 *
 * 解除で必ずネイティブと `Linking` の購読も手放す（最後の 1 人が抜けたら `remove()`）。
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

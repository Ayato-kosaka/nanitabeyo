// lib/sharedTextSource.android.ts
//
// #1400（親 #1375）PR2: Android の共有（`ACTION_SEND` / `text/plain`）を受け取る実装。
//
// ## Metro が拡張子で選ぶ。`sharedTextSource.ts` は消さないこと
//
// Android では **このファイル**が `lib/sharedTextSource` として解決され、web と
// «まだ実装の無いプラットフォーム»（iOS は PR3・#1472 待ち）は `lib/sharedTextSource.ts` の
// 「何も来ない」実装のままになる。分岐と «起動時の値» の罠の対処は PR1 が
// `lib/sharedText.ts` / `lib/snsShareIntake.ts` に閉じているので、ここでやり直さない。
//
// ## 手段の判定: **A（既存ライブラリ `expo-share-intent`）を採用した**
//
// 方針は「A を第一候補とし、不適合の証拠を示せた場合に限り B（自前 config plugin ＋
// 最小ネイティブモジュール）へ落とす」。実測した事実は以下で、**不適合の証拠が出なかった**ため A。
//
// | 確かめたこと | 実測値 |
// | --- | --- |
// | 対応 Expo SDK | `expo-share-intent@5.1.1` の `peerDependencies.expo` が `^54`。README の対応表も «SDK 54 → 5.0+»。こちらは `expo@54.0.36` |
// | peer 制約 | `expo-linking >=8.0.8`（こちらは `~8.0.12`）/ `expo-constants >=18.0.8`（こちらは `~18.0.13`）/ `react`・`react-native` は `*`（RN 0.81.5 で制約なし）。`pnpm add` で **この依存に対する peer 警告は 0 件** |
// | 最終更新 | 5.1.x は 2025-11 リリース。最新は 8.0.1（2026-07-10、SDK 57 向け）で、SDK ごとに追従している系列 |
// | CNG 対応 | config plugin（`app.plugin.js`）を同梱。`ios/` `android/` を持たないこのリポジトリでもネイティブ設定を `app.config.ts` だけで表現できる |
// | iOS の App Group | **Android には不要**。App Group を要求するのは iOS の Share Extension 側だけで、plugin も `disableIOS` / `disableAndroid` で片側だけ有効にできる |
// | `expo prebuild --platform android` | 依存を入れた状態で **成功**。生成された `AndroidManifest.xml` に `ACTION_SEND` + `category.DEFAULT` + `mimeType="text/plain"` が入り、既存の VIEW（App Links / カスタムスキーム）はそのまま残る |
// | Android の autolinking | `expo-modules-autolinking resolve -p android` が `expo.modules.shareintent.ExpoShareIntentModule` を解決する。**PR2 では plugin を `app.config.ts` へ足していない**（intent-filter は下記の理由で自前で書いた）が、ネイティブモジュール自体は autolink される |
//
// PR2 で `app.config.ts` の `plugins` へ `expo-share-intent` を足していないのは、この plugin の
// Android 側の仕事が «`SEND text/*` の intent-filter 追加» と «MainActivity の
// `launchMode="singleTask"` 付与» の 2 つだけで、前者は `android.intentFilters` に自分で
// `text/plain` として書いた方が狭く正確、後者は **Expo の既定テンプレートが既に `singleTask`**
// （prebuild 出力で確認済み）だからである。二重に intent-filter を生やす方が害が大きい。
//
// ⚠️ PR3（iOS）は逆に plugin が必要になる（Share Extension のターゲット生成）。そのときは
// `["expo-share-intent", { disableAndroid: true, iosAppGroupIdentifier: ... }]` の形で足し、
// Android 側は引き続きこのファイルと `android.intentFilters` が担当すること。
// なお iOS 側は `patch-package` による xcode パッチが要る（README の Installation）。**Android には不要**。
//
// ## 同じ共有を 2 回流さないための構造
//
// `Linking.getInitialURL()` が «起動時の URL» を返し続けるのと同じ罠が `ACTION_SEND` にもある
// （`app/index.tsx:23,72,97` に既知の罠として記録されている）。Android では起動した intent が
// `getIntent()` に残り続けるため、素直に読むと画面が再マウントされるたびに同じ URL を取り込む。
// ここでは 3 段で閉じている。
//
// 1. **ネイティブ側で消す** … `getShareIntent()` はネイティブの保持（`ExpoShareIntentSingleton.intent`）を
//    読んだ直後に `null` にする。取りこぼしを避けるため、こちらからも `clearShareIntent()` を明示的に呼ぶ
// 2. **このモジュールで «起動時の 1 回» を使い切る** … `hasReadInitial` はモジュールスコープ、つまり
//    プロセス寿命。2 回目以降はネイティブを叩かずに `null` を返す
// 3. **起動時の 1 本を購読側へ流さない** … 起動時の共有もアプリ内の共有も、ネイティブからは同じ
//    `onChange` イベントで届く。待機中（`initialCapture` がある間）のイベントは «起動時の共有» として
//    確定させ、購読リスナーへは渡さない。両方へ流すと 1 回の共有が 2 回取り込まれる
//
// ⚠️ 残る穴（正直に書く）: バックグラウンドでプロセスごと OS に落とされた後にタスクから復帰すると、
// Android は **元の共有 intent で** MainActivity を作り直すため、次のプロセスで同じ値をもう一度読む。
// ここは JS からは触れない（`activity.intent` を差し替える口がライブラリに無い）。頻度が低く、
// 実害は「取り込み確認画面がもう一度出る」だけなので PR2 では受け入れる。

import ShareIntentModule from "expo-share-intent/build/ExpoShareIntentModule";
import type { ChangeEventPayload } from "expo-share-intent/build/ExpoShareIntentModule.types";

import type { SharedTextListener, SharedTextSource } from "./sharedText";

/**
 * ネイティブ関数へ渡すキー。iOS では «どのスキームの App Group を見るか» に使うが、
 * Android の実装は引数を捨てている（`ExpoShareIntentModule.kt` の `AsyncFunction("getShareIntent") { _: String -> }`）。
 * それでも型が `String` を要求するので空文字を渡す。
 */
const SHARE_INTENT_KEY = "";

/**
 * 「共有がある」と言われたのにイベントが来ないときに諦めるまでの時間。
 *
 * `hasShareIntent()` はネイティブが «type 付きの intent で起動された» ことしか知らないので、
 * 画像共有のようにこの層が扱えない intent でも true になりうる。上限を置かないと
 * `consumeInitialSharedText()` の await が永久に返らず、**起動時の採用機会を握ったまま**になる。
 */
const INITIAL_SHARE_TIMEOUT_MS = 2000;

/** `onChange` で届くネイティブの値。text/plain の共有は `{ text, type: "text" }` で来る */
type NativeShareIntentValue = {
	text?: string | null;
	type?: string | null;
};

/**
 * ネイティブの値を素直な object に均す。
 *
 * Android は Map をそのまま送ってくるが、iOS 実装は JSON 文字列で送る系統がある
 * （ライブラリ側の `parseShareIntent()` も両方を受ける）。将来 iOS を同じ形にしても
 * ここが壊れないよう、両方を受けておく。
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
 * `type` が `"text"` のものだけを通す。`intentFilters` で `text/plain` に絞ってあるとはいえ、
 * 共有シートの実装によっては画像やファイル（`type: "file"`）が飛んでくる。ここで落とさないと
 * 取り込み確認画面が «URL の無い共有» で開く。
 *
 * ⚠️ **URL かどうかはここでは見ない。** 判定は `parseSnsUrl()` に一本化されており
 * （`lib/snsShareIntake.ts` の doc コメント）、URL でない共有テキストは «対応 provider の説明»
 * へ進むのが設計上の正しい行き先である（設計 §6 R-4）。ここで捨てると «共有したのに何も起きない» に戻る。
 * そのため文字列は trim せず、OS から来た生の値のまま渡す（空白だけのときだけ落とす）。
 */
const extractSharedText = (value: unknown): string | null => {
	const parsed = parseNativeValue(value);
	if (!parsed || parsed.type !== "text") return null;
	if (typeof parsed.text !== "string" || parsed.text.trim().length === 0) return null;
	return parsed.text;
};

/** 起動済みのアプリへ来た共有を受け取るリスナー */
const listeners = new Set<SharedTextListener>();

/** ネイティブの `onChange` 購読。利用者（起動時の待機 + 各リスナー）が居る間だけ張る */
let nativeSubscription: { remove: () => void } | null = null;
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

const retainNative = () => {
	nativeRefCount += 1;
	if (nativeRefCount > 1) return;
	nativeSubscription = ShareIntentModule?.addListener("onChange", onNativeChange) ?? null;
};

const releaseNative = () => {
	nativeRefCount = Math.max(0, nativeRefCount - 1);
	if (nativeRefCount > 0) return;
	nativeSubscription?.remove();
	nativeSubscription = null;
};

/**
 * 起動のきっかけになった共有テキスト。無ければ `null`。
 *
 * ネイティブは «起動時の共有» も «起動中に来た共有» も同じ `onChange` で通知するため、
 * ここでは「先にリスナーを張る → `getShareIntent()` を呼ぶ → 最初に来たイベントを採用する」
 * という順序で 1 本だけ受け取る。順序を入れ替えるとイベントを取りこぼす。
 */
const getInitialSharedText = async (): Promise<string | null> => {
	// ⚠️ await の «前» に立てること（`consumeInitialSharedText()` と同じ理由）
	if (hasReadInitial) return null;
	hasReadInitial = true;

	// dev client を作り直していない・Expo Go・web バンドルを Android で読んだ、等では null になる
	const nativeModule = ShareIntentModule;
	if (!nativeModule) return null;

	let isPending = false;
	try {
		isPending = nativeModule.hasShareIntent(SHARE_INTENT_KEY);
	} catch {
		return null;
	}
	// 共有以外（ランチャー・ディープリンク）で起動したときはここで終わる。ネイティブを叩かない
	if (!isPending) return null;

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
					await nativeModule.getShareIntent(SHARE_INTENT_KEY);
				} catch {
					settle(null);
				}
			})();
		});
	} finally {
		releaseNative();
		// ネイティブ側の保持を必ず空にする。JS のフラグはプロセスが変わると消えるので、
		// これを省くと «次の起動» で同じ共有をもう一度読む（lib/sharedText.ts の警告）
		try {
			nativeModule.clearShareIntent(SHARE_INTENT_KEY);
		} catch {
			// 消せなくても取り込み自体は成立している。ここで投げてアプリを止める方が害が大きい
		}
	}
};

/**
 * 起動済みのアプリへ来た共有を受け取る。戻り値は購読解除関数。
 *
 * 解除で必ずネイティブの購読も手放す（最後の 1 人が抜けたら `remove()`）。
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

/** Android の受け取り口。`lib/sharedTextSource.ts` の «何も来ない» 実装を置き換える */
export const sharedTextSource: SharedTextSource = {
	getInitialSharedText,
	subscribeSharedText,
};

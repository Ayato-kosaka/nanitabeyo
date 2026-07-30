import { element, waitFor } from "detox";

/**
 * ⏳ 待機ヘルパ
 *
 * Detox の `waitFor(...).toBeVisible().withTimeout(...)` は毎回 4 段のチェーンになり、
 * spec / Screen Object に散らばると「どこにどのタイムアウトが効いているか」が読めなくなる。
 * ここへ集約し、タイムアウトの既定値も 1 箇所で管理する。
 *
 * ⚠️ Detox には Playwright の `waitForResponse` に相当するネットワーク傍受 API が無い。
 * 「API 応答を待つ」目的の待機は Detox の同期機構（ネットワークが落ち着くまで次の操作を
 * ブロックする仕組み）に委ね、**画面上の観測点**（要素の出現/消失）で待つこと。
 */

/**
 * 画面表示待ちの既定タイムアウト（ms）。
 * 実 API（Cloud Run api-development）のコールドスタートを見込み、e2e-web の expect.timeout より長めに取る。
 *
 * #1027 15 秒では iOS シミュレータで足りなかった（run 30432596949 のディープリンク →
 * マイページで `profile-login-button` の描画がプロフィール取得待ちに引きずられて間に合わなかった）。
 * この値を払うのは **失敗するときだけ**なので、通過時の実行時間には影響しない。
 */
export const DEFAULT_TIMEOUT = 25_000;

/**
 * アプリ起動待ちのタイムアウト（ms）。
 * release APK の初回起動は「JS バンドル読込 → 匿名認証 or セッション注入 → 初回描画」を含むため長い。
 */
export const LAUNCH_TIMEOUT = 120_000;

/**
 * 要素が可視になるまで待つ。
 *
 * @param matcher 対象のマッチャ（例: `by.id("tab-search")`）
 * @param timeout タイムアウト (ms)。既定 DEFAULT_TIMEOUT
 * @失敗時 タイムアウト時に Detox の例外を投げる（失敗時スクリーンショットは .detoxrc.js の artifacts 設定で保存される）
 */
export async function waitUntilVisible(
	matcher: Detox.NativeMatcher,
	timeout: number = DEFAULT_TIMEOUT,
	index?: number,
): Promise<void> {
	await waitFor(target(matcher, index)).toBeVisible().withTimeout(timeout);
}

/**
 * マッチャを操作対象の要素へ変換する。
 *
 * #1027 【バグ】Detox は **複数一致した状態で `element(matcher)` を操作すると例外**になる。
 * しかもそのメッセージは "matches 2 views in the hierarchy" で、
 * ベストエフォート系ヘルパ（`existsNow` 等）では「存在しない」と誤判定されてしまう
 * （run 30429560108 では、これが原因でチュートリアルの後始末が毎回スキップされていた）。
 * TrueSheet のように **同じ testID の View がツリーへ二重に現れる**実装があるため、
 * 「複数一致しうると分かっている要素」は呼び出し側が index を明示できるようにしておく。
 *
 * @param matcher 対象のマッチャ
 * @param index 複数一致する場合に選ぶ添字。省略時は「一意であること」を要求する
 */
function target(matcher: Detox.NativeMatcher, index?: number): Detox.NativeElement {
	return index === undefined ? element(matcher) : element(matcher).atIndex(index);
}

/**
 * 要素が可視になるのを待ってからタップする。
 *
 * #1027 【バグ】**Screen Object のタップは必ずこれを使うこと。**
 * iOS は Detox の同期機構を無効化しているため（`fixtures/e2e.ts` の `detoxEnableSynchronization: 0`。
 * 有効にすると常駐アニメーションで永遠にアイドル判定にならない。恒久対応は #1040）、
 * `element(...).tap()` を待たずに呼ぶと **画面の描画が終わる前にタップが飛び**、
 * "No elements found" で落ちる（run 30432596949 の iOS で `profile-settings-button` が実際にこれ）。
 * Android では同期機構が吸収してくれるので顕在化しないが、待ってから押して困ることは無い。
 *
 * @param matcher 対象のマッチャ
 * @param timeout 可視待ちのタイムアウト (ms)
 * @param index 複数一致する場合に選ぶ添字
 */
export async function tapWhenVisible(
	matcher: Detox.NativeMatcher,
	timeout: number = DEFAULT_TIMEOUT,
	index?: number,
): Promise<void> {
	await waitUntilVisible(matcher, timeout, index);

	// #1027 【バグ】iOS は「見えているのに叩けない」状態が一時的に起こる。
	// Detox の tap は対象の中心を hit-test して同じ View が返ることを要求するが、
	// collapsible なヘッダーやモーダルの遷移中は **透明な View が一瞬上に載る**ため、
	// "View is not hittable at its visible point" で失敗する
	// （run 30460621899 の iOS で `profile-settings-button` が実際にこれ。同じ spec が
	//   リトライでは通っており、恒常的に叩けないわけではない）。
	// アニメーションが落ち着けば叩けるので、この種のエラーに限って数回だけ待って叩き直す
	await tapWithHitTestRetry(matcher, index);
}

/** hit-test の一時的な失敗に限って数回だけ待って叩き直す（tapWhenVisible / tapWhenPresent 共通） */
async function tapWithHitTestRetry(matcher: Detox.NativeMatcher, index?: number): Promise<void> {
	await withHitTestRetry(() => target(matcher, index).tap());
}

/**
 * hit-test の一時的な失敗に限って数回だけ待ってタップ動作をやり直す。
 *
 * ⚠️ やり直しても二重に届かない前提で使うこと。ここで再試行の対象にしているのは
 * **タップが 1 度も配送されずに失敗した**ことを示すエラー（`isTransientHitTestError`）だけで、
 * 「押せたが結果が期待と違う」類のエラーは対象にしていない。
 *
 * @param action 実行するタップ動作
 */
async function withHitTestRetry(action: () => Promise<void>): Promise<void> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			await action();
			return;
		} catch (error) {
			if (attempt >= TAP_RETRY_LIMIT || !isTransientHitTestError(error)) throw error;
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}
}

/**
 * 要素が **ツリーに在る**のを待ってからタップする（iOS の可視判定を通せない要素向け）。
 *
 * #1027 【バグ】iOS の `toBeVisible` は「面積の 75% 以上が見えていて他の View に覆われていないこと」を
 * 要求する。検索画面の下端に固定された FAB（`search-submit-button`）はこの判定を通らず、
 * 25 秒待ってもタイムアウトする（run 30493326741 で実測。ソフトウェアキーボードを無効化しても再現した）。
 * 同じ画面の下端に来る要素（詳細条件の距離セクション）も以前から同じ症状で、
 * spec 側では既に `toExist` へ倒してある。
 *
 * 画面には確かに描画されており（Artifact のスクリーンショットで確認済み）タップ自体は届くため、
 * **存在で待って、タップは hit-test の一時的失敗に対する再試行付きで行う**。
 *
 * ⚠️ 既定は `tapWhenVisible` を使うこと。可視判定を捨てるのは
 * 「見えているのに Detox の判定だけが通らない」と実測できた要素に限る。
 *
 * @param matcher 対象のマッチャ
 * @param timeout 存在待ちのタイムアウト (ms)
 * @param index 複数一致する場合に選ぶ添字
 */
export async function tapWhenPresent(
	matcher: Detox.NativeMatcher,
	timeout: number = DEFAULT_TIMEOUT,
	index?: number,
): Promise<void> {
	await waitUntilExists(matcher, timeout, index);
	await tapWithHitTestRetry(matcher, index);
}

/**
 * 要素が **ツリーに在る**のを待ってから、`times` 回の連続タップを **1 つの Detox アクション**として送る。
 *
 * #1084 【設計】§3-2: 連打の再現に `tap()` の連続は使えない。Android は Detox の同期機構が有効なため
 * （fixtures/e2e.ts の `platformLaunchOptions()` は Android に `detoxEnableSynchronization` を渡さない）、
 * `await tap(); await tap();` と書くと **1 発目のあと画面遷移とネットワークの完了まで待ってから**
 * 2 発目が飛ぶ。連打事故が起きる脆弱な窓（React のコミット前 / ガードが立っている間）を確実に外すため、
 * 事故があってもテストが緑になる（＝ 感度ゼロ）。
 *
 * Detox のアイドル待機はアクションと**アクションの間**に入るものなので、`multiTap` の内部の
 * タップ間には待機が挟まらない。これが Android でも脆弱な窓へ複数タップを入れられる唯一の標準手段。
 * iOS は元から同期を無効化してあるが、両プラットフォームで同じコードにするため統一して使う。
 *
 * 可視ではなく **存在**で待つ理由は `tapWhenPresent` と同じ（連打の主対象である検索 FAB は
 * iOS の `toBeVisible` を満たせない）。
 *
 * @param matcher 対象のマッチャ
 * @param times 連打回数
 * @param timeout 存在待ちのタイムアウト (ms)
 * @param index 複数一致する場合に選ぶ添字
 */
export async function multiTapWhenPresent(
	matcher: Detox.NativeMatcher,
	times: number,
	timeout: number = DEFAULT_TIMEOUT,
	index?: number,
): Promise<void> {
	await waitUntilExists(matcher, timeout, index);
	await withHitTestRetry(() => target(matcher, index).multiTap(times));
}

/** 「見えているのに叩けない」の再試行回数（1 回 500ms 待つ） */
const TAP_RETRY_LIMIT = 4;

/**
 * iOS の hit-test 由来で **一時的に**叩けないことを示すエラーかどうか。
 * 「そもそも要素が無い」「別の画面にいる」といった本物の失敗は再試行しても無駄なので、
 * ここに挙げた文言に限定する。
 */
function isTransientHitTestError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes("not hittable at its visible point") ||
		message.includes("View is not visible around point") ||
		message.includes("is not scrollable at the given start point")
	);
}

/**
 * 要素がビューツリーに存在するまで待つ（画面外にあってもよい場合はこちら）。
 *
 * @param matcher 対象のマッチャ
 * @param timeout タイムアウト (ms)
 */
export async function waitUntilExists(
	matcher: Detox.NativeMatcher,
	timeout: number = DEFAULT_TIMEOUT,
	index?: number,
): Promise<void> {
	await waitFor(target(matcher, index)).toExist().withTimeout(timeout);
}

/**
 * 要素がビューツリーから消えるまで待つ（モーダル・スナックバーの閉じ待ちなど）。
 *
 * @param matcher 対象のマッチャ
 * @param timeout タイムアウト (ms)
 */
export async function waitUntilGone(
	matcher: Detox.NativeMatcher,
	timeout: number = DEFAULT_TIMEOUT,
	index?: number,
): Promise<void> {
	await waitFor(target(matcher, index)).not.toExist().withTimeout(timeout);
}

/**
 * 要素が存在するかどうかを **待たずに** 判定する。
 *
 * 「出ていれば閉じる」といったベストエフォート処理に使う。
 * ⚠️ 通常のアサーションには使わないこと（false は「まだ描画されていない」だけの可能性がある）。
 *
 * @param matcher 対象のマッチャ
 * @param timeout 存在確認に費やす上限 (ms)。既定 2 秒（短くして無駄な待ちを避ける）
 * @returns 存在すれば true / しなければ false（例外は投げない）
 */
export async function existsNow(matcher: Detox.NativeMatcher, timeout = 2_000, index?: number): Promise<boolean> {
	try {
		await waitFor(target(matcher, index)).toExist().withTimeout(timeout);
		return true;
	} catch (error) {
		rethrowIfAppIsGone(error);
		return false;
	}
}

/**
 * 要素が **可視かどうか** を待たずに判定する。
 *
 * `existsNow` との違いは「ビューツリーに在るか」ではなく「実際に見えているか」を見る点。
 * 前面にモーダル（初回チュートリアル等）が被っている状況を検出したいときは、
 * 存在では区別できないためこちらを使う。
 *
 * @param matcher 対象のマッチャ
 * @param timeout 判定に費やす上限 (ms)。既定 2 秒
 * @returns 可視なら true / そうでなければ false（例外は投げない）
 */
export async function visibleNow(matcher: Detox.NativeMatcher, timeout = 2_000, index?: number): Promise<boolean> {
	try {
		await waitFor(target(matcher, index)).toBeVisible().withTimeout(timeout);
		return true;
	} catch (error) {
		rethrowIfAppIsGone(error);
		return false;
	}
}

/**
 * 要素が **見えなくなる**まで待つ。
 *
 * #1027 `waitUntilGone`（= `not.toExist()`）との使い分け:
 * ツリーから消えるかどうかがプラットフォームで揺れる要素（TrueSheet の中身など）は、
 * 「存在しない」ではなく **「ユーザーから見えない」** で判定する方が壊れにくい。
 *
 * @param matcher 対象のマッチャ
 * @param timeout タイムアウト (ms)
 * @param index 複数一致する場合に選ぶ添字
 * @失敗時 期限内に見えなくならなければ日本語のメッセージで例外を投げる
 */
export async function waitUntilNotVisible(
	matcher: Detox.NativeMatcher,
	timeout: number = DEFAULT_TIMEOUT,
	index?: number,
): Promise<void> {
	await waitUntil(async () => !(await visibleNow(matcher, 1_000, index)), {
		timeout,
		interval: 250,
		description: "要素が見えなくなること",
	});
}

/**
 * 「アプリが落ちている / Detox が接続できていない」ことを示すエラーの断片。
 *
 * #1027 【バグ】`existsNow` / `visibleNow` はベストエフォート判定なので **あらゆる例外を false へ潰す**が、
 * アプリのクラッシュだけは潰してはいけない。潰すとポーリングが最後まで空回りし、
 * ログには "Detox can't seem to connect to the test app(s)!" が数千行積み上がったうえで
 * 「要素が見つからない」という **原因と無関係な失敗**として報告される（run 30429560108 で実測）。
 */
const APP_IS_GONE_SIGNS = [
	"can't seem to connect to the test app",
	"has crashed",
	"app has not been running",
	"Detox instance has not been initialized",
];

/**
 * アプリが落ちている類のエラーなら、握り潰さずに投げ直す。
 *
 * @param error 判定対象の例外
 * @失敗時（意図的） APP_IS_GONE_SIGNS のいずれかを含むメッセージなら、元の例外をそのまま throw する
 */
function rethrowIfAppIsGone(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	if (APP_IS_GONE_SIGNS.some((sign) => message.includes(sign))) throw error;
}

/**
 * 任意の条件が真になるまでポーリングして待つ（要素の可視性では表せない状態変化用）。
 *
 * #1031 【設計】B1: 「いいね済みかどうか」のような **選択状態** は Detox のマッチャでは待てない
 * （`accessibilityState` を検証する API が無い）。状態は `getAttributes()` で読み取るしかなく、
 * 読み取り結果に対する待ちはこのヘルパで行う。
 *
 * ⚠️ 要素の出現待ちには使わないこと。それは `waitUntilVisible` の仕事で、
 * Detox の同期機構と噛み合った待ち方をしてくれる。
 *
 * @param predicate 真になれば待機を終える判定関数。例外を投げた場合は「まだ偽」とみなして継続する
 * @param options.timeout タイムアウト (ms)。既定 DEFAULT_TIMEOUT
 * @param options.interval ポーリング間隔 (ms)。既定 500
 * @param options.description タイムアウト時のメッセージに載せる、何を待っていたかの説明
 * @失敗時 期限内に真にならなければ日本語のメッセージで例外を投げる
 */
export async function waitUntil(
	predicate: () => Promise<boolean>,
	options: { timeout?: number; interval?: number; description?: string } = {},
): Promise<void> {
	const { timeout = DEFAULT_TIMEOUT, interval = 500, description = "条件" } = options;
	const deadline = Date.now() + timeout;

	for (;;) {
		let satisfied = false;
		try {
			satisfied = await predicate();
		} catch (error) {
			// #1027 アプリが落ちている場合だけは再試行せず即座に失敗させる（原因不明の空回りを防ぐ）
			rethrowIfAppIsGone(error);
			// 判定中の例外（要素の再マウント中など）は「まだ偽」とみなして再試行する
			satisfied = false;
		}
		if (satisfied) return;

		if (Date.now() >= deadline) {
			throw new Error(`${description} が ${timeout}ms 以内に成立しませんでした。`);
		}
		await new Promise((resolve) => setTimeout(resolve, interval));
	}
}

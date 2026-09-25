import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import * as Updates from "expo-updates";
import { useLogger } from "@/hooks/useLogger";
import { flushLogQueue } from "@/lib/logQueue";
import { toErrorLogMessage } from "@/lib/errorMessage";

/**
 * #1641 【設計】**OTA を «次の起動» まで待たせない。**
 *
 * ## なぜ要るのか（実測）
 *
 * `expo-updates` は依存に入っているのに、アプリのコードから 1 度も import されていなかった。
 * `app.config.ts` の `updates` も URL しか持たない。この既定の挙動は
 *
 *   起動 → **キャッシュ済みのバンドルで動き出す** → 裏で新しいものを落とす → **次の起動で適用**
 *
 * であり、つまり利用者が触っている JS は **常に 1 つ前**である。
 *
 * 2026-08-31 に、これが «直したのに直っていない» の正体だった。この日 OTA を 12 本出したが、
 * BigQuery で `frontend_event_logs` を見ると、オーナー端末が実際に走らせた最新のコミットは
 * 前日 08-30 の `9b646339` で、**当日の修正は 1 本も動いていなかった**。
 * 修正の当否以前に、修正が端末へ届いていなかった。
 *
 * ## 何をするか
 *
 * 起動時に更新を確認して落としておき、**次に前面へ戻ってきたとき**に作り直す。
 * 「落とした瞬間に作り直す」はしない — 動画を見ている最中にアプリが再起動する。
 *
 * ただし **起動してすぐ**（まだ何も見ていないうち）に取得できたときだけは、その場で作り直す。
 * ここを待つと «起動 → 背面 → 前面» の往復が要り、結局 1 テンポ遅れて届くことになる。
 * 目安は {@link IMMEDIATE_RELOAD_WINDOW_MS}。
 *
 * - 背面に居た時間が {@link MIN_BACKGROUND_MS} 未満なら作り直さない。
 *   アプリを一瞬切り替えただけで画面の状態が飛ぶのを防ぐ
 * - 作り直しは 1 セッションに 1 回だけ（`hasReloadedRef`）。
 *   確認 → 取得 → 作り直し → 確認 … が回り続けることはない
 * - `Updates.channel` が無いビルド（ローカル prebuild / dev client / E2E CI のネイティブビルド）
 *   では何もしない。**テストの最中に勝手に作り直されるのを防ぐための門**なので外さないこと
 *
 * ## ログ
 *
 * `ota_update_downloaded` と `ota_update_applied` を残す。`created_commit_id` が乗るので、
 * «どのバンドルからどのバンドルへ移ったか» が後から追える。`reloadAsync` は JS ごと
 * 落とすため、送信を待たずに呼ぶとログが消える。{@link FLUSH_GRACE_MS} だけ待ってから呼ぶ。
 */

/** 直前の背面滞在がこれ未満なら «切り替えただけ» とみなし、作り直さない */
const MIN_BACKGROUND_MS = 8_000;
/**
 * 起動からこの時間内に取得できたら、前面復帰を待たずにその場で作り直す。
 * まだ «開いた直後» なので、作り直しても飛ぶ状態がほとんど無い。
 */
const IMMEDIATE_RELOAD_WINDOW_MS = 15_000;
/** reload の前に、溜まっているログを送り切るための猶予 */
const FLUSH_GRACE_MS = 1_200;

/**
 * #2069 【設計】**«撃ち直せば直る失敗» と «撃ち直しても直らない失敗» を分ける。**
 *
 * 2026-09-24 から本番の OTA が **1 件も届かなくなった**（Expo 無料枠の
 * «Monthly Updating Users» 超過で更新チェックが全件 429）。それでも 2 日間・800 件超の間、
 * **起票が 1 件も無かった**。失敗を全部 `warn` で記録していて、error-triage は
 * `error_level = 'error'` しか集めないためである。
 *
 * 回線が細いときに失敗するのは本当に «正常な範囲» で、次の前面復帰で撃ち直せば直る。
 * 一方で **枠の使い切り・認可の失敗は、何度撃ち直しても直らない**。
 * 同じ `warn` へ混ぜると、後者が前者に飲み込まれて誰にも見えなくなる。
 *
 * ⚠️ **判定は本文の文字列でしかできない。** `expo-updates` は `checkForUpdateAsync` の失敗を
 * ステータスコードを持たない `Error` で投げるので、`error.status` のような構造化された値が無い
 * （実測のメッセージ: `HTTP response error 429: The number of Monthly Updating Users has
 * exceeded the Free tier's quota for this account. …`）。だから **文字列で当てる**。
 *
 * ⚠️ **判定に外れたら `warn` に倒す**（= 従来どおり）。恒久的な失敗を取りこぼす方が、
 * 回線起因を `error` に上げて毎晩起票されるより安い、という判断ではない。逆である:
 * 偽陽性で «直っているのに赤い» を作ると次から誰も見ないので、**確実に恒久的なものだけ**を上げる。
 * 取りこぼしが出たらここへ 1 行足す。
 *
 * ⚠️ **既に分かっている取りこぼしが 1 つある。** 本番 30 日で
 * `Call to function 'ExpoUpdates.checkForUpdateAsync' has been rejected. → Caused by:
 * Failed to check for update` が **141 件 / 48 ユーザー / 09-12 から連続**で出ているが、
 * このネイティブ側の文言は **理由を一切含まない**ので、429 なのか回線なのか判別できない。
 * だから `warn` のままになる。切り分けられるように `platform` を payload へ載せた
 * （iOS は HTTP の本文が上がってくるのに Android は上がってこない、という仮説を測るため）。
 */
const PERMANENT_FAILURE_PATTERNS: readonly RegExp[] = [
	// 枠の使い切り。Expo の無料枠（MAU）超過がこれ
	/\b429\b/,
	/quota/i,
	/exceeded/i,
	// 認可。プロジェクト設定やトークンが壊れている状態で、撃ち直しても直らない
	/\b401\b/,
	/\b403\b/,
	/unauthorized/i,
	/forbidden/i,
];

/**
 * 更新チェックの失敗が «撃ち直しても直らない» ものかどうか。
 *
 * 判定できないもの（回線・DNS・Expo 側の 5xx など）は `false` を返す。テストから直接呼ぶため export する。
 */
export const isPermanentUpdateFailure = (message: string): boolean =>
	PERMANENT_FAILURE_PATTERNS.some((pattern) => pattern.test(message));

export const OtaUpdateApplier = () => {
	const { logFrontendEvent } = useLogger();

	/** 取得済みで、まだ適用していない update の ID */
	const pendingUpdateIdRef = useRef<string | null>(null);
	/** 確認・取得が走っている最中か（前面復帰の連打で二重に走らせない） */
	const isCheckingRef = useRef(false);
	/** このセッションで既に作り直したか。ループ防止の最後の砦 */
	const hasReloadedRef = useRef(false);
	/** 背面へ回った時刻。前面に居るときは null */
	const backgroundedAtRef = useRef<number | null>(null);
	/** このコンポーネントが立ち上がった時刻（≒ 起動時刻） */
	const mountedAtRef = useRef(Date.now());
	/**
	 * いま前面に居るか。`AppState.currentState` を読まずに自前で持つ。
	 * あれはプラットフォームによって "unknown" を返す瞬間があり、
	 * «前面のときだけ当てる» の判定をそこへ預けると静かに素通りする
	 */
	const isForegroundRef = useRef(true);

	/** OTA を扱ってよいビルドか。web / dev client / ローカルビルドはすべて対象外 */
	const isApplicable = Platform.OS !== "web" && Updates.isEnabled && !!Updates.channel;

	/**
	 * 取得済みの update を適用する（＝ JS を作り直す）。
	 * ログは `reloadAsync` で JS ごと落ちるため、送り切る猶予を置いてから呼ぶ。
	 */
	const applyPendingUpdate = useCallback(
		(toUpdateId: string, context: { reason: "launch" | "foreground"; awayMs?: number }) => {
			if (hasReloadedRef.current) return;
			hasReloadedRef.current = true;

			logFrontendEvent({
				event_name: "ota_update_applied",
				error_level: "log",
				payload: {
					channel: Updates.channel,
					runtimeVersion: Updates.runtimeVersion,
					fromUpdateId: Updates.updateId,
					toUpdateId,
					reason: context.reason,
					awayMs: context.awayMs,
				},
			});
			flushLogQueue();
			setTimeout(() => {
				void Updates.reloadAsync();
			}, FLUSH_GRACE_MS);
		},
		[logFrontendEvent],
	);

	const checkAndFetch = useCallback(async () => {
		if (isCheckingRef.current || hasReloadedRef.current) return;
		if (pendingUpdateIdRef.current) return;

		isCheckingRef.current = true;
		try {
			const check = await Updates.checkForUpdateAsync();
			if (!check.isAvailable) return;

			const fetched = await Updates.fetchUpdateAsync();
			if (!fetched.isNew) return;

			const toUpdateId = fetched.manifest?.id ?? "unknown";
			pendingUpdateIdRef.current = toUpdateId;

			const sinceMountMs = Date.now() - mountedAtRef.current;
			logFrontendEvent({
				event_name: "ota_update_downloaded",
				error_level: "log",
				payload: {
					channel: Updates.channel,
					runtimeVersion: Updates.runtimeVersion,
					fromUpdateId: Updates.updateId,
					toUpdateId,
					sinceMountMs,
				},
			});

			// 起動直後で、まだ前面に居るうちに間に合ったなら待たずに当てる
			if (sinceMountMs <= IMMEDIATE_RELOAD_WINDOW_MS && isForegroundRef.current) {
				applyPendingUpdate(toUpdateId, { reason: "launch" });
			}
		} catch (error) {
			// 回線が細い・Expo が落ちている等で失敗するのは正常な範囲。次の前面復帰で撃ち直す。
			// ⚠️ ただし «撃ち直しても直らない» 失敗をここへ混ぜない（#2069）。
			const message = toErrorLogMessage(error);
			const permanent = isPermanentUpdateFailure(message);
			logFrontendEvent({
				event_name: "ota_update_check_failed",
				error_level: permanent ? "error" : "warn",
				// ⚠️ platform を載せるのは «判定できなかった失敗» を後から切り分けるため（下の注記）
				payload: { error: message, channel: Updates.channel, permanent, platform: Platform.OS },
			});
		} finally {
			isCheckingRef.current = false;
		}
	}, [logFrontendEvent, applyPendingUpdate]);

	useEffect(() => {
		if (!isApplicable) return;
		void checkAndFetch();
	}, [isApplicable, checkAndFetch]);

	useEffect(() => {
		if (!isApplicable) return;

		const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
			if (next !== "active") {
				isForegroundRef.current = false;
				// iOS は active → inactive → background と 2 段で来る。最初の 1 回だけ覚える
				if (backgroundedAtRef.current === null) backgroundedAtRef.current = Date.now();
				return;
			}

			isForegroundRef.current = true;

			const awayMs = backgroundedAtRef.current === null ? 0 : Date.now() - backgroundedAtRef.current;
			backgroundedAtRef.current = null;

			const pendingUpdateId = pendingUpdateIdRef.current;
			if (!pendingUpdateId || hasReloadedRef.current || awayMs < MIN_BACKGROUND_MS) {
				void checkAndFetch();
				return;
			}

			applyPendingUpdate(pendingUpdateId, { reason: "foreground", awayMs });
		});

		return () => subscription.remove();
	}, [isApplicable, checkAndFetch, applyPendingUpdate]);

	return null;
};

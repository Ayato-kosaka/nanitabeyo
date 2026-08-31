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
/** reload の前に、溜まっているログを送り切るための猶予 */
const FLUSH_GRACE_MS = 1_200;

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

	/** OTA を扱ってよいビルドか。web / dev client / ローカルビルドはすべて対象外 */
	const isApplicable = Platform.OS !== "web" && Updates.isEnabled && !!Updates.channel;

	const checkAndFetch = useCallback(async () => {
		if (isCheckingRef.current || hasReloadedRef.current) return;
		if (pendingUpdateIdRef.current) return;

		isCheckingRef.current = true;
		try {
			const check = await Updates.checkForUpdateAsync();
			if (!check.isAvailable) return;

			const fetched = await Updates.fetchUpdateAsync();
			if (!fetched.isNew) return;

			pendingUpdateIdRef.current = fetched.manifest?.id ?? "unknown";
			logFrontendEvent({
				event_name: "ota_update_downloaded",
				error_level: "log",
				payload: {
					channel: Updates.channel,
					runtimeVersion: Updates.runtimeVersion,
					fromUpdateId: Updates.updateId,
					toUpdateId: pendingUpdateIdRef.current,
				},
			});
		} catch (error) {
			// 回線が細い・Expo が落ちている等で失敗するのは正常な範囲。次の前面復帰で撃ち直す
			logFrontendEvent({
				event_name: "ota_update_check_failed",
				error_level: "warn",
				payload: { error: toErrorLogMessage(error), channel: Updates.channel },
			});
		} finally {
			isCheckingRef.current = false;
		}
	}, [logFrontendEvent]);

	useEffect(() => {
		if (!isApplicable) return;
		void checkAndFetch();
	}, [isApplicable, checkAndFetch]);

	useEffect(() => {
		if (!isApplicable) return;

		const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
			if (next !== "active") {
				// iOS は active → inactive → background と 2 段で来る。最初の 1 回だけ覚える
				if (backgroundedAtRef.current === null) backgroundedAtRef.current = Date.now();
				return;
			}

			const awayMs = backgroundedAtRef.current === null ? 0 : Date.now() - backgroundedAtRef.current;
			backgroundedAtRef.current = null;

			const pendingUpdateId = pendingUpdateIdRef.current;
			if (!pendingUpdateId || hasReloadedRef.current || awayMs < MIN_BACKGROUND_MS) {
				void checkAndFetch();
				return;
			}

			hasReloadedRef.current = true;
			logFrontendEvent({
				event_name: "ota_update_applied",
				error_level: "log",
				payload: {
					channel: Updates.channel,
					runtimeVersion: Updates.runtimeVersion,
					fromUpdateId: Updates.updateId,
					toUpdateId: pendingUpdateId,
					awayMs,
				},
			});
			flushLogQueue();
			setTimeout(() => {
				void Updates.reloadAsync();
			}, FLUSH_GRACE_MS);
		});

		return () => subscription.remove();
	}, [isApplicable, checkAndFetch, logFrontendEvent]);

	return null;
};

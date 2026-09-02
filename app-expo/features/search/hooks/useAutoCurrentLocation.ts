import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthProvider";
import { useLogger } from "@/hooks/useLogger";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { LocationPermissionError } from "@/hooks/locationPermissionError";
import type { LocationDetailsResponse } from "@shared/api/v1/res";

type CurrentLocation = Omit<LocationDetailsResponse, "viewport">;

type Params = {
	/** 逆ジオコーディングまで含む現在地取得（内部で `useAPICall` を使うため JWT を要求する） */
	getCurrentLocation: () => Promise<CurrentLocation>;
	/** 取得できた現在地を画面へ反映する */
	onResolved: (location: CurrentLocation) => void;
};

/**
 * #1092 検索画面の「現在地の自動取得」。
 *
 * これは `didInitTutorialState` の一度きりガードの内側から呼ばれるため、**失敗しても再試行されない**。
 * 現在地取得は `hooks/useLocationSearch.ts` の逆ジオコーディングを経由して `useAPICall` を叩くので、
 * 認証がまだ確立していない（`getSession()` にトークンが無い）時点で呼ばれると必ず失敗し、
 * その起動では **現在地が二度と入らない** ことになる。
 *
 * そこで「トークンが無かっただけの失敗」を区別して覚えておき、auth の解決（セッション獲得）で
 * 1 回だけ取り直す。ユーザーの操作起点の取得（現在地ボタン）は従来どおり呼び出し側の責務で、
 * ここでは扱わない（あちらは失敗を Snackbar で伝える）。
 *
 * ループしないことの保証:
 * 1. `requestAutoCurrentLocation()` が呼ばれるまで何もしない
 * 2. 成功したら二度と動かない
 * 3. 再試行はトークン欠如で失敗したときだけ、かつ 1 回だけ
 * 4. 発火源は `user` の変化（外部起点の認証イベント）だけで、この処理は `user` を変化させない
 */
export const useAutoCurrentLocation = ({ getCurrentLocation, onResolved }: Params) => {
	const { user } = useAuth();
	const { logFrontendEvent } = useLogger();

	/** 成功済みか。成功後は auth の変化で取り直さない（ユーザーが選び直した地点を上書きしないため） */
	const hasResolvedRef = useRef(false);
	/** 実行中か。二重発火で逆ジオコーディングを二度叩かない */
	const isFetchingRef = useRef(false);
	/** 直前の失敗が「トークンが無いだけ」だったか（= auth の解決を待てば成功しうる） */
	const needsAuthRetryRef = useRef(false);
	/** auth 解決後の再試行を使ったか */
	const hasRetriedAfterAuthRef = useRef(false);

	// onResolved は呼び出し側でインライン定義されがちなので、ref 経由で最新を読む
	// （effect の依存に入れて再実行が増えるのを避ける）
	const onResolvedRef = useRef(onResolved);
	onResolvedRef.current = onResolved;
	const getCurrentLocationRef = useRef(getCurrentLocation);
	getCurrentLocationRef.current = getCurrentLocation;

	const fetchCurrentLocation = useCallback(async () => {
		if (hasResolvedRef.current || isFetchingRef.current) return;
		isFetchingRef.current = true;

		try {
			const currentLocation = await getCurrentLocationRef.current();
			hasResolvedRef.current = true;
			needsAuthRetryRef.current = false;
			onResolvedRef.current(currentLocation);
		} catch (error: any) {
			// #1092 認証未確立のためトークンが無かっただけなら、恒久的な失敗ではない
			needsAuthRetryRef.current = error?.code === "unauthenticated";

			// #932 【修正】マウント時の自動取得はユーザー操作を伴わないため Snackbar は出さない(UX を損なうため)。
			// ただし console.error への握りつぶしをやめ、理由(kind)付きで構造化ログに残す
			logFrontendEvent({
				event_name: "current_location_auto_fetch_failed",
				error_level: "warn",
				payload: {
					error: toErrorLogMessage(error),
					kind: error instanceof LocationPermissionError ? error.kind : "unavailable",
					willRetryAfterAuth: needsAuthRetryRef.current && !hasRetriedAfterAuthRef.current,
				},
			});
		} finally {
			isFetchingRef.current = false;
		}
	}, [logFrontendEvent]);

	/** 現在地の自動取得を要求する（呼び出し側の一度きりガードの内側から呼ばれる想定） */
	const requestAutoCurrentLocation = useCallback(() => {
		void fetchCurrentLocation();
	}, [fetchCurrentLocation]);

	useEffect(() => {
		if (!user) return;
		if (!needsAuthRetryRef.current) return;
		if (hasRetriedAfterAuthRef.current) return;

		hasRetriedAfterAuthRef.current = true;
		needsAuthRetryRef.current = false;
		void fetchCurrentLocation();
	}, [user?.id, fetchCurrentLocation]);

	return { requestAutoCurrentLocation };
};

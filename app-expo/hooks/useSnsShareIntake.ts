// hooks/useSnsShareIntake.ts
//
// #1400（親 #1375）共有されたテキストを受け取って、取り込みの行き先へ送る。
//
// 判定は `lib/snsShareIntake.ts`（純関数）、受け取り口は `lib/sharedTextSource.ts`（PR2 / PR3 で差し替え）、
// このフックが持つのは **「いつ読むか」と「いつ遷移してよいか」** だけである。

import { useCallback, useEffect, useRef } from "react";
import { router, useRootNavigationState } from "expo-router";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { consumeInitialSharedText, type SharedTextSource } from "@/lib/sharedText";
import { sharedTextSource as defaultSharedTextSource } from "@/lib/sharedTextSource";
import { resolveSnsShareIntake } from "@/lib/snsShareIntake";

/**
 * 認証の決着を待つ上限。超えたらその時点の状態で判定する。
 *
 * 待たずに判定すると、コールドスタート直後は `user === null`（未確定）なので
 * **ログイン済みのユーザーがログイン画面へ送られる**（`lib/authGuest.ts` は未確定をゲストへ倒す）。
 * 逆に無限に待つと共有が無言で消えるので、上限を置いて「待つが、諦めもする」形にする。
 */
const AUTH_RESOLVE_TIMEOUT_MS = 3000;

/**
 * 🔗 共有されたテキストを取り込みの入口へ流す。UI は持たない。
 *
 * ## 遷移の前にナビゲータの準備完了を待つ（#1027 の再発防止）
 *
 * ルートナビゲータのマウント前に遷移すると expo-router の `assertIsReady` が
 * 「Attempted to navigate before mounting the Root Layout component.」を投げ、
 * **JS 例外でアプリごと落ちる**。`useRootNavigationState()` の key で準備完了を判定する
 * （`app/index.tsx:47` / `app/[locale]/_layout.tsx` と同じ作法）。
 *
 * ## 起動時の共有は «プロセスにつき 1 回だけ» 採用する（#1124 と同じ罠）
 *
 * 詳細は `lib/sharedText.ts` の `hasConsumedInitialSharedText` の doc コメント。
 * ここでは `consumeInitialSharedText()` を通すことだけを守る。直接 `getInitialSharedText()` を
 * 呼ぶと「一度共有した URL がアプリを開くたびに何度も取り込まれる」に戻る。
 *
 * ## `router.push`（`replace` ではない）
 *
 * 共有は「今見ている画面を捨てる操作」ではない。取り込みをやめたユーザーが戻れるように push する。
 *
 * @param source 受け取り口。既定は `lib/sharedTextSource.ts`（PR1 では常に «共有なし»）。
 *               テストと PR2 / PR3 の差し替えのために引数で受けられるようにしてある
 */
export function useSnsShareIntake(source: SharedTextSource = defaultSharedTextSource): void {
	const { locale } = useLocale();
	const { getSession, waitForAuthResolved } = useAuth();
	const { logFrontendEvent } = useLogger();
	const rootNavigationState = useRootNavigationState();
	const isNavigationReady = rootNavigationState?.key != null;

	// effect を locale の変化で貼り直さずに «最新の locale» を読むための参照。
	// 貼り直すと購読の解除と再登録が起き、その隙間に来た共有を取りこぼしうる
	const localeRef = useRef(locale);
	useEffect(() => {
		localeRef.current = locale;
	}, [locale]);

	const handleSharedText = useCallback(
		async (sharedText: string) => {
			// #1194 と同じ理由で render 時点のスナップショット（`isAuthResolved`）ではなく «待つ» 方を使う。
			// 決着後の user は sessionRef を同期参照する getSession() から読む（再 render を待たない）
			// #1375 実機確認: 行き先の判定にログイン状態は要らなくなった（取り込みは匿名可）。
			// それでも **認証の決着は待つ**。取り込み画面は着地直後に `resolve` を叩くので、
			// セッションが未確定のまま着くと最初の 1 本が 401 になる
			await waitForAuthResolved(AUTH_RESOLVE_TIMEOUT_MS);

			const route = resolveSnsShareIntake({ sharedText, locale: localeRef.current });

			logFrontendEvent({
				event_name: "sns_share_intake_routed",
				error_level: "log",
				payload: {
					routeType: route.type,
					// ⚠️ 共有テキストそのものはログに載せない。第三者が作った任意の文字列であり、
					// 取り込めたかどうかの分析には「どこへ送ったか」で足りる
					hasUrl: route.type === "import" ? route.params.url != null : true,
				},
			});

			router.push({ pathname: route.pathname, params: route.params });
		},
		[logFrontendEvent, waitForAuthResolved],
	);

	useEffect(() => {
		// locale が未確定（遷移の途中経過では空文字になりうる。`app/[locale]/_layout.tsx` のコメント参照）の
		// 間は «消費» しない。ここで読むと行き先のロケールを間違えたまま 1 回きりの採用を使い切る
		if (!isNavigationReady || !locale) return;

		let cancelled = false;

		void (async () => {
			const sharedText = await consumeInitialSharedText(source);
			if (!sharedText || cancelled) return;
			await handleSharedText(sharedText);
		})();

		// 起動済みのアプリへ来た共有。こちらは «今回の共有» なので毎回採用してよい
		const unsubscribe = source.subscribeSharedText((sharedText) => {
			if (cancelled) return;
			void handleSharedText(sharedText);
		});

		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [isNavigationReady, locale, source, handleSharedText]);
}

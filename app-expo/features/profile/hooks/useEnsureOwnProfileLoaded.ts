import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { ApiError, useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { userProfile } from "@/data/profileData";
import { useProfileStore } from "../stores/useProfileStore";
import type { GetUserProfileResponse } from "@shared/api/v1/res";
import { Image } from "expo-image";
import { useProfile } from "./useProfile";

/**
 * ログインユーザーのプロフィールをストアに確実にロードするカスタムフック
 *
 * 機能:
 * - 初回実行時のみ API を呼び出してプロフィールをストアに保存
 * - 2回目以降は API を呼ばず、ストアのキャッシュを利用
 * - ゲストユーザーの場合は userProfile のダミーデータを設定
 *
 * 使用例:
 * ```tsx
 * function MyComponent() {
 *   useEnsureOwnProfileLoaded();
 *   const profile = useProfileStore(state => state.profile);
 *   // profile が利用可能
 * }
 * ```
 *
 * #1120 【設計】戻り値の `isProfileResolved` は「ロードが決着したか（成功・失敗を問わず）」。
 * `profile === null` は「まだ読んでいない」と「読んだが取れなかった」の両方を意味するため、
 * これだけを見て UI を分岐すると、ログイン済みユーザーにも数百 ms だけゲスト向け UI が出て
 * 消える（= ちらつき）。未決着の間は分岐そのものを保留する用途に使う。
 *
 * #1387 【設計】戻り値の `retry` は「決着したが取れなかった」状態からやり直すための唯一の手段。
 * このフックは `hasLoadedRef` で «一度きり» を保証しており、失敗しても finally で立ててしまうので、
 * 再レンダーしても二度と API を叩かない。呼び出し側が明示的に `retry()` を呼んだときだけ
 * その封印を解く。
 *
 * ⚠️ `retry()` は «決着済み» のときに押させること（`isProfileResolved === false` の間は
 * まだ読み込み中なので、押せると同じ取得が二重に走る）。エラー表示を `hasLoadFailed` で出せば、
 * ボタンは自然に決着後だけ現れる。
 *
 * #1387 【設計】戻り値の `hasLoadFailed` は「**このフックの取得が実際に落ちた**」ことを持つ。
 *
 * ⚠️ 呼び出し側で `isProfileResolved && !profile` から «失敗» を推論しないこと（PR #1392 のレビュー）。
 * `isProfileResolved` はこのフックインスタンス固有の state だが、`profile` は **共有ストア**なので、
 * 第三者がストアを空にすると「失敗していないのに失敗」と読めてしまう。実際に 2 経路ある。
 *   1. `AuthProvider` の `onAuthStateChange` が `resetProfile()` と `setUser()` を同じコールバックで
 *      呼ぶため、1 コミットだけ «決着済み × profile なし» になる（#1120 が潰した «出てから消える»）
 *   2. 別の消費者（ReviewForm 等）が新しく mount するとそのセッション effect が `resetProfile()` し、
 *      決着済みの画面は **その取得が終わるまで** 失敗表示に落ちる
 * どちらも自己回復するが、その間ユーザーには «予期しないエラー» が見えている。
 */
export function useEnsureOwnProfileLoaded(): {
	isProfileResolved: boolean;
	hasLoadFailed: boolean;
	retry: () => void;
} {
	const { user } = useAuth();
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { createUserProfile } = useProfile();
	// ロード済みフラグとリトライフラグを管理するための ref
	const hasLoadedRef = useRef(false);
	// #1120 ref は再レンダーを起こさないため、呼び出し側へ返す決着状態は state で持つ
	const [isProfileResolved, setIsProfileResolved] = useState(false);
	// #1387 再試行の世代。下のロード effect の依存に入れてあり、増えると «もう一度» 走る
	const [attempt, setAttempt] = useState(0);
	// #1387 «このフックの取得が落ちた» ことを明示的に持つ（ストアの状態から推論しない）
	const [hasLoadFailed, setHasLoadFailed] = useState(false);

	// #1092 PR4b タブの表示判定（lib/authGuest.ts）と同じ式にしておく。
	// ここだけ判定がずれると「reviews タブは出ているのにプロフィールはダミーのまま」になる
	const isGuest = isGuestUser(user);

	/**
	 * #1387 取得に失敗した状態からやり直す。
	 *
	 * `hasLoadedRef` を倒さないとロード effect が即 return するので、ここで «一度きり» の封印を解く。
	 * `attempt` を増やすのは effect を «実際に» 走らせるため（ref の書き換えは再レンダーを起こさない）。
	 */
	const retry = useCallback(() => {
		hasLoadedRef.current = false;
		setIsProfileResolved(false);
		setHasLoadFailed(false);
		setAttempt((current) => current + 1);
	}, []);

	// ★セッション（userId / isGuest）が変わったらキャッシュをリセット
	useEffect(() => {
		useProfileStore.getState().resetProfile();
		hasLoadedRef.current = false;
		// #1120 セッションが変わればロードもやり直しになるので、決着状態も未決着へ戻す
		setIsProfileResolved(false);
		// #1387 前のセッションの失敗を引きずらない
		setHasLoadFailed(false);
	}, [user?.id, isGuest]);

	useEffect(() => {
		// #467 【設計】既にプロフィールがロード済みの場合は何もしない
		if (hasLoadedRef.current) {
			setIsProfileResolved(true);
			return;
		}
		const { profile, setProfile } = useProfileStore.getState();
		if (profile) {
			setIsProfileResolved(true);
			return;
		}

		const loadProfile = async () => {
			// #467 【設計】ゲストユーザーの場合はダミープロフィールを設定
			if (isGuest) {
				setProfile(userProfile);
				hasLoadedRef.current = true;
				setIsProfileResolved(true);
				return;
			}

			if (hasLoadedRef.current) return;
			try {
				const data = await callBackend<{}, GetUserProfileResponse>(`v1/users/${user?.id}`, {
					method: "GET",
					requestPayload: {},
				});
				// #467 【設計】アバター画像をプリフェッチして表示を高速化
				const avatarUrl = data.avatarUrls?.md;
				avatarUrl && (await Image.prefetch(avatarUrl));
				setProfile(data);
				// ⚠️ 防御的に置いている。ここへ来る時点で hasLoadFailed は必ず false である
				//（true になれるのは «決着した失敗» の後だけで、そこから再取得へ戻る経路
				//   ＝ retry() とセッション effect は、どちらも先に false を書いている）。
				// 落としてもテストは緑のままだが、将来 «失敗のまま再取得» の経路が増えたときの保険
				setHasLoadFailed(false);
			} catch (rawError: unknown) {
				const error = rawError as ApiError;
				if (error.status === 404) {
					// #260 【設計】プロフィールが存在しない場合は新規作成(冪等)
					await createUserProfile({});
					// 再度ロードを試みる
					if (hasLoadedRef.current) return;
					const data = await callBackend<{}, GetUserProfileResponse>(`v1/users/${user?.id}`, {
						method: "GET",
						requestPayload: {},
					});
					// #467 【設計】アバター画像をプリフェッチして表示を高速化
					const avatarUrl = data.avatarUrls?.md;
					avatarUrl && (await Image.prefetch(avatarUrl));
					setProfile(data);
					// 上と同じ理由の防御。到達時点では false である
					setHasLoadFailed(false);
					return;
				}
				// その他のエラーはログに記録
				setHasLoadFailed(true);
				logFrontendEvent({
					event_name: "load_own_profile_error",
					error_level: "error",
					payload: { message: error.message, userId: user?.id, isGuest },
				});
			} finally {
				hasLoadedRef.current = true;
				// #1120 失敗しても「決着した（= これ以上待っても profile は増えない）」ことは確定する。
				// ここを成功時だけにすると、プロフィール取得が落ちた人の UI が永久にローディングで固まる
				setIsProfileResolved(true);
			}
		};

		// #1387 404 分岐の中（createUserProfile / 再取得）で投げると、その reject は catch の外へ抜ける。
		// finally は走るので UI は正しく失敗表示になるが、拾わないと未処理の rejection が残り、
		// retry() で «押すたびに» 再発できる。決着済みであることは finally が保証しているので、
		// ここでは «失敗した» ことだけを立てて握り潰す（PR #1392 のレビュー S-1）
		loadProfile().catch(() => setHasLoadFailed(true));
		// #1387 `attempt` は «再試行のたびにこの effect を回す» ためだけの依存。
		// 値そのものは中で使わないが、外すと retry() が効かなくなる
	}, [callBackend, isGuest, logFrontendEvent, user?.id, createUserProfile, attempt]);

	return { isProfileResolved, hasLoadFailed, retry };
}

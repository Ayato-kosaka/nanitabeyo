/*
このファイルの責務
- オンボーディングの許可画面（app/[locale]/onboarding/location.tsx / notifications.tsx）が
  **このアプリ起動中に** 何と答えられたかを覚えておく。

#1736 【バグ】**断った直後に、説明の無い許可ダイアログがもう一度出る。**

オンボーディングを抜けた先に、同じ許可を «無条件で» 要求する経路がもう 1 本ずつある。

| 許可 | 直後に要求する場所 | どうなるか |
| --- | --- | --- |
| 位置情報 | 検索画面の現在地の自動取得（features/search/hooks/useAutoCurrentLocation.ts → hooks/useCurrentLocationPosition.ts） | Android は `canAskAgain` が残っている限り、もう一度ダイアログを出す |
| 通知 | components/PushTokenRegistration.tsx（オンボーディングを抜けた瞬間に effect が張り直される） | 同上（Android 13+ の POST_NOTIFICATIONS） |

ユーザーから見ると「今断ったのに、また聞かれた」になる。そこで «オンボーディングがこの起動で
尋ねて、許可されなかった» ことだけを覚えておき、後続の要求側がそれを見て見送る。

永続化しない（AsyncStorage へ書かない）のは、次回の起動や、設定アプリで許可へ変えて
戻ってきた場合まで抑止したくないため。

⚠️ ユーザー操作起点の取得（検索画面の «現在地» ボタン）は抑止しない。
自分で押した人には OS のダイアログが出るのが正しい。
*/
import type { PermissionOutcome } from "./permissions";

/** オンボーディングが尋ねる許可の種類 */
export type OnboardingPermissionKind = "location" | "notifications";

/** `undefined` = このアプリ起動中、オンボーディングはまだその許可を尋ねていない */
const outcomes: Partial<Record<OnboardingPermissionKind, PermissionOutcome>> = {};

/** オンボーディングの許可画面が受け取った答えを記録する */
export const rememberOnboardingPermissionOutcome = (
	kind: OnboardingPermissionKind,
	outcome: PermissionOutcome,
): void => {
	outcomes[kind] = outcome;
};

/** オンボーディングがこの起動で受け取った答え。まだ尋ねていなければ `null` */
export const getOnboardingPermissionOutcome = (kind: OnboardingPermissionKind): PermissionOutcome | null =>
	outcomes[kind] ?? null;

/**
 * オンボーディングが尋ねた結果、**許可されなかった**か。
 *
 * 「まだ尋ねていない」は false（＝従来どおり要求してよい）。既存ユーザーや
 * オンボーディングを通らない言語（#642）の人の唯一の要求機会を奪わないため。
 */
export const wasDeniedInOnboarding = (kind: OnboardingPermissionKind): boolean => {
	const outcome = getOnboardingPermissionOutcome(kind);
	return outcome !== null && outcome !== "granted";
};

/** テスト専用: モジュールスコープの状態を初期化する */
export const __resetOnboardingPermissionOutcomesForTest = (): void => {
	for (const key of Object.keys(outcomes) as OnboardingPermissionKind[]) delete outcomes[key];
};

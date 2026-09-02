/*
このファイルの責務
- オンボーディング導線（#1486）の «次にどこへ行くか» を決める純関数を 1 箇所へ集める。

⚠️ `router` を引数に取らないこと。文字列と boolean だけを受けて «結果» を返す形にしてある。
router を渡す形にすると、テストが expo-router のモックの都合に引きずられる
（lib/authNext.ts と同じ方針）。

## 導線の全体像（#1486 冒頭「初回導線」）

```
検索画面（未読）
  └─ push ─> /[locale]/onboarding            3 ステップ
                └─ push ─> /[locale]/auth/login   既存ログイン画面（ログイン / スキップ）
                              └─ replace ─> /[locale]/onboarding/location   位置情報許可
                                              ├─ replace ─> /[locale]/onboarding/notifications  ※ログイン済みのみ
                                              └─ replace ─> /[locale]/onboarding/welcome
                                                              └─ dismiss ─> 検索画面（アプリ本体）
                                                                              └─ ATT
```

ログイン画面までを `push` にしているのは、ログイン画面の戻るで «3 枚目» に帰れるようにするため。
そこから先を `replace` にしているのは、許可フローを «一方通行» にするため
（位置情報ダイアログへ答えた後に戻れても意味が無く、戻ると OS ダイアログの再表示もされない）。
*/

/** `？`（ヘルプ）から手動で開いたのか、初回導線として自動で開いたのか */
export type OnboardingMode =
	/** 初回導線。3 ステップの後にログイン → 権限 → Welcome まで続く */
	| "full"
	/** #1486 §3 検索画面右上の `？` から開いた場合。3 ステップだけを見せて元の画面へ戻す */
	| "manual";

/** URL の `?mode=` を `OnboardingMode` へ落とす。未知の値は初回導線として扱う */
export const parseOnboardingMode = (mode: unknown): OnboardingMode => (mode === "manual" ? "manual" : "full");

/** 3 ステップ画面のパス */
export const onboardingIndexPath = (locale: string, mode: OnboardingMode = "full"): string =>
	mode === "manual" ? `/${locale}/onboarding?mode=manual` : `/${locale}/onboarding`;

/** 位置情報許可画面のパス */
export const onboardingLocationPath = (locale: string): string => `/${locale}/onboarding/location`;

/** 通知許可画面のパス */
export const onboardingNotificationsPath = (locale: string): string => `/${locale}/onboarding/notifications`;

/** Welcome 画面のパス */
export const onboardingWelcomePath = (locale: string): string => `/${locale}/onboarding/welcome`;

/**
 * 3 ステップを終えた後に開く既存ログイン画面のパス（#1486 §4）。
 *
 * - `next` … ログイン成功時 / スキップ時の行き先。位置情報許可画面を指す
 * - `skippable=1` … この画面に «スキップ» を出してよい、という印
 *
 * #1486 §4【設計】`skippable` を明示のパラメータにしているのは、**ログイン画面の既存の
 * 呼び出し元（口コミ・プロフィール・店舗詳細）へスキップを生やさないため**。
 * それらは「ログインが要るからログイン画面へ送っている」ので、素通りできてしまうと
 * ログイン必須の画面へ未ログインのまま入れてしまう。`next` の有無で出し分けると
 * その 3 箇所すべてに付いてしまうため、印は別に持つ。
 */
export const onboardingLoginPath = (locale: string): string =>
	`/${locale}/auth/login?next=${encodeURIComponent(onboardingLocationPath(locale))}&skippable=1`;

/**
 * 位置情報許可の «次» を決める（#1486 §6）。
 *
 * 通知許可は **ログイン済みユーザーのみ**。ログインをスキップした人には
 * このオンボーディング中は通知許可を要求しない（要求しても届け先が無い。
 * 実際 components/PushTokenRegistration.tsx も匿名ユーザーには登録しない）。
 */
export const resolveAfterLocationPath = (params: { isLoggedIn: boolean; locale: string }): string =>
	params.isLoggedIn ? onboardingNotificationsPath(params.locale) : onboardingWelcomePath(params.locale);

/** アプリ本体（検索タブ）のパス。Welcome の「はじめる」と、`？` から開いたときの戻り先 */
export const appRootPath = (locale: string): string => `/${locale}/(tabs)/search`;

/**
 * パスがオンボーディング導線の途中かどうか（#1486 §8 の ATT 遅延に使う）。
 *
 * ログイン画面を含めているのは、3 ステップとログインの間で ATT ダイアログが
 * 割り込むのを防ぐため。ログイン画面はオンボーディング以外からも開かれるが、
 * その場合も «画面を出ている間だけ» ATT を待たせるだけで、離れれば要求される。
 */
export const isOnboardingPath = (pathname: string): boolean =>
	/(^|\/)onboarding(\/|$)/.test(pathname) || /(^|\/)auth\/(login|callback)(\/|$)/.test(pathname);

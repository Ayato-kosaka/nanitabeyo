/**
 * 🚫 injectTestSession の no-op 実装（本番・通常ビルド用）。
 *
 * metro.config.js が以下の条件で injectTestSession.ts をこのファイルへ解決し直す（#1030）:
 * - `EXPO_PUBLIC_E2E_AUTH_HOOK !== "1"`（= E2E ビルド以外の全て）
 * - platform === "web"（web には react-native-launch-arguments のネイティブ実装が無く、E2E 対象でもないため）
 *
 * これにより本番バンドルには「起動引数からセッションを注入するコード」も
 * react-native-launch-arguments も一切含まれない。
 *
 * ⚠️ injectTestSession.ts と同じ公開シグネチャを保つこと（差し替えは Metro の resolver 段で行われるため、
 *    型不一致は typecheck では検出できない。実装を変更したら必ず両方を揃えること）。
 */

// #1030 【設計】本番バンドルに sentinel を残さないため、この noop 側では E2E_TEST_SESSION_SENTINEL を定義しない
//（scripts/assert-no-e2e-hook.mjs は sentinel の有無で混入を検知するので、noop に置くとゲートが常に落ちる）

export type E2ESessionOwner = "anon" | "authenticated";

export type InjectTestSessionResult = "skipped" | "already-matched" | "injected";

/** 通常ビルドでは常に何もしない（= 本フックが存在しないのと同じ挙動） */
export const injectTestSession = async (): Promise<InjectTestSessionResult> => "skipped";

/** 通常ビルドでは E2E 由来のエラーは発生し得ないため常に false */
export const isTestSessionInjectionError = (_error: unknown): boolean => false;

// #1030 【設計】(レビュー m-2) impl とのシグネチャ乖離を typecheck で検出する（型のみの参照 = バンドルへは出ない）。
// sentinel は noop に存在しないため、モジュール全体ではなく公開関数単位で突き合わせる
import type * as Impl from "./injectTestSession";
const _injectSignatureCheck: (typeof Impl)["injectTestSession"] = injectTestSession;
const _isErrorSignatureCheck: (typeof Impl)["isTestSessionInjectionError"] = isTestSessionInjectionError;
void _injectSignatureCheck;
void _isErrorSignatureCheck;

/**
 * 🚫 readE2ETutorialSeen の no-op 実装（本番・通常ビルド用）。
 *
 * metro.config.js が以下の条件で tutorialSeed.ts をこのファイルへ解決し直す（#1027）:
 * - `EXPO_PUBLIC_E2E_TUTORIAL_HOOK !== "1"`（= E2E ビルド以外の全て）
 * - platform === "web"（web には react-native-launch-arguments のネイティブ実装が無く、Detox の対象でもない）
 *
 * これにより本番バンドルには「起動引数でチュートリアル視聴済みフラグを固定するコード」が一切含まれない。
 *
 * ⚠️ tutorialSeed.ts と同じ公開シグネチャを保つこと（差し替えは Metro の resolver 段で行われるため、
 *    型不一致は typecheck では検出できない。実装を変更したら必ず両方を揃えること）。
 */

// #1027 【設計】本番バンドルに sentinel を残さないため、この noop 側では E2E_TUTORIAL_SEED_SENTINEL を定義しない
//（scripts/assert-no-e2e-hook.mjs は sentinel の有無で混入を検知するので、noop に置くとゲートが常に落ちる）

/** 通常ビルドでは常に「固定なし」= AsyncStorage の実データを読む */
export function readE2ETutorialSeen(): boolean | null {
	return null;
}

// #1030 m-2 と同じく、impl とのシグネチャ乖離を typecheck で検出する（型のみの参照 = バンドルへは出ない）
import type * as Impl from "./tutorialSeed";
const _readSignatureCheck: (typeof Impl)["readE2ETutorialSeen"] = readE2ETutorialSeen;
void _readSignatureCheck;

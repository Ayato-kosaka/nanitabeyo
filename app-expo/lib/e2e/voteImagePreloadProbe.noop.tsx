import type React from "react";

/**
 * 🚫 e2eVoteImagePreloadProbeElement の no-op 実装（本番・通常ビルド用）。
 *
 * metro.config.js が以下の条件で voteImagePreloadProbe.tsx をこのファイルへ解決し直す（#1213）:
 * - `EXPO_PUBLIC_E2E_TUTORIAL_HOOK !== "1"`（= E2E ビルド以外の全て）
 * - platform === "web"（web の先読みは e2e-web が Resource Timing で観測しており、プローブは不要）
 *
 * これにより本番バンドルには「先読み件数を画面に出すコード」が一切含まれない。
 *
 * ⚠️ voteImagePreloadProbe.tsx と同じ公開シグネチャを保つこと（差し替えは Metro の resolver 段で
 *    行われるため、型不一致は typecheck では検出できない。実装を変更したら必ず両方を揃えること）。
 */

// #1213 【設計】本番バンドルに sentinel を残さないため、この noop 側では
// E2E_VOTE_IMAGE_PRELOAD_PROBE_SENTINEL を定義しない
//（scripts/assert-no-e2e-hook.mjs は sentinel の有無で混入を検知するので、noop に置くとゲートが常に落ちる）

export type E2EVoteImagePreloadCounts = {
	ready: number;
	failed: number;
	total: number;
};

/** 通常ビルドでは何も描画しない */
export function e2eVoteImagePreloadProbeElement(_counts: E2EVoteImagePreloadCounts): React.ReactElement | null {
	return null;
}

// #1030 m-2 と同じく、impl とのシグネチャ乖離を typecheck で検出する（型のみの参照 = バンドルへは出ない）
import type * as Impl from "./voteImagePreloadProbe";
const _probeSignatureCheck: (typeof Impl)["e2eVoteImagePreloadProbeElement"] = e2eVoteImagePreloadProbeElement;
void _probeSignatureCheck;

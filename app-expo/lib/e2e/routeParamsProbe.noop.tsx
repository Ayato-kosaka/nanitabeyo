import type React from "react";

/**
 * 🚫 e2eRouteParamsProbeElement の no-op 実装（本番・通常ビルド用）。
 *
 * metro.config.js が以下の条件で routeParamsProbe.tsx をこのファイルへ解決し直す（#1272）:
 * - `EXPO_PUBLIC_E2E_TUTORIAL_HOOK !== "1"`（= E2E ビルド以外の全て）
 * - platform === "web"（#1272 は iOS 固有の症状で、web の ?tab= は e2e-web が担保している）
 *
 * これにより本番バンドルには「ルートパラメータを画面に出すコード」が一切含まれない。
 *
 * ⚠️ routeParamsProbe.tsx と同じ公開シグネチャを保つこと（差し替えは Metro の resolver 段で
 *    行われるため、型不一致は typecheck では検出できない。実装を変更したら必ず両方を揃えること）。
 */

// 【設計】本番バンドルに sentinel を残さないため、この noop 側では E2E_ROUTE_PARAMS_PROBE_SENTINEL を定義しない
//（scripts/assert-no-e2e-hook.mjs は sentinel の有無で混入を検知するので、noop に置くとゲートが常に落ちる）

export type E2ERouteParamsProbeEntries = Record<string, string | undefined>;

/** 通常ビルドでは何も描画しない */
export function e2eRouteParamsProbeElement(_entries: E2ERouteParamsProbeEntries): React.ReactElement | null {
	return null;
}

// #1030 m-2 と同じく、impl とのシグネチャ乖離を typecheck で検出する（型のみの参照 = バンドルへは出ない）
import type * as Impl from "./routeParamsProbe";
const _probeSignatureCheck: (typeof Impl)["e2eRouteParamsProbeElement"] = e2eRouteParamsProbeElement;
void _probeSignatureCheck;

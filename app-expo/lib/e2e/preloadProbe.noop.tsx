import type React from "react";

/**
 * 🚫 useE2EPreloadProbe の no-op 実装（本番・通常ビルド用）。
 *
 * metro.config.js が以下の条件で preloadProbe.tsx をこのファイルへ解決し直す（#1087）:
 * - `EXPO_PUBLIC_E2E_TUTORIAL_HOOK !== "1"`（= E2E ビルド以外の全て）
 * - platform === "web"（web の先読みは e2e-web が Resource Timing で観測しており、プローブは不要）
 *
 * これにより本番バンドルには「先読み枚数を数えて画面に出すコード」が一切含まれない。
 *
 * ⚠️ preloadProbe.tsx と同じ公開シグネチャを保つこと（差し替えは Metro の resolver 段で行われるため、
 *    型不一致は typecheck では検出できない。実装を変更したら必ず両方を揃えること）。
 */

// #1087 【設計】本番バンドルに sentinel を残さないため、この noop 側では E2E_PRELOAD_PROBE_SENTINEL を定義しない
//（scripts/assert-no-e2e-hook.mjs は sentinel の有無で混入を検知するので、noop に置くとゲートが常に落ちる）

export type E2EPreloadImageProps = {
	onLoad?: () => void;
	onError?: () => void;
};

export type E2EPreloadProbe = {
	imageProps: (index: number) => E2EPreloadImageProps;
	element: React.ReactElement | null;
};

/** 通常ビルドでは `<Image>` へ何も足さず、カウンタ要素も描画しない */
const NOOP_PROBE: E2EPreloadProbe = {
	imageProps: () => ({}),
	element: null,
};

/**
 * 通常ビルドでは常に「計測しない」。
 *
 * @param _total 先読み対象の枚数（使わない）
 */
export function useE2EPreloadProbe(_total: number): E2EPreloadProbe {
	return NOOP_PROBE;
}

// #1030 m-2 と同じく、impl とのシグネチャ乖離を typecheck で検出する（型のみの参照 = バンドルへは出ない）
import type * as Impl from "./preloadProbe";
const _probeSignatureCheck: (typeof Impl)["useE2EPreloadProbe"] = useE2EPreloadProbe;
void _probeSignatureCheck;

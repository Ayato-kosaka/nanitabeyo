import type { MediaData } from "../mediaSelection";

/**
 * 🚫 selectMediaStub の no-op 実装（本番・通常ビルド用）。
 *
 * metro.config.js が以下の条件で selectMediaStub.ts をこのファイルへ解決し直す（#1031 B6）:
 * - `EXPO_PUBLIC_E2E_MEDIA_HOOK !== "1"`（= E2E ビルド以外の全て）
 * - platform === "web"（web は Detox の対象外）
 *
 * これにより本番バンドルには「メディア選択を固定画像へ差し替えるコード」が一切含まれない。
 *
 * ⚠️ selectMediaStub.ts と同じ公開シグネチャを保つこと。
 */

// #1031 本番バンドルに sentinel を残さないため、noop 側では E2E_MEDIA_SELECTION_SENTINEL を定義しない
//（scripts/assert-no-e2e-hook.mjs は sentinel の有無で混入を検知するので、noop に置くとゲートが常に落ちる）

/** 通常ビルドでは常に差し替えない（= 本フックが存在しないのと同じ挙動） */
export async function selectMediaForE2E(): Promise<MediaData | null> {
	return null;
}

// #1030 レビュー m-2 と同じ考え方: impl とのシグネチャ乖離を typecheck で検出する
//（型のみの参照なのでバンドルへは出ない）。sentinel は noop に無いため公開関数単位で突き合わせる
import type * as Impl from "./selectMediaStub";
const _selectMediaSignatureCheck: (typeof Impl)["selectMediaForE2E"] = selectMediaForE2E;
void _selectMediaSignatureCheck;

import type { LocationPermissionErrorKind } from "@/hooks/locationPermissionError";
import i18n from "@/lib/i18n";

/**
 * #1133 【設計】現在地取得の失敗時の出し分けを、画面から独立した純関数として持つ。
 *
 * 元は `app/[locale]/(tabs)/search/index.tsx` にローカル関数として書かれていた #932 の出し分けを
 * そのまま切り出したもの。保存料理タブ（`features/profile/`）でも同じ現在地取得を提供するにあたり、
 * 「同じ失敗理由に画面ごとに違う文言が出る」ことを構造的に防ぐために共有する。
 *
 * ⚠️ ホーム（検索タブ）側は**まだ差し替えていない**。ホームの移行は別 Issue で行う。
 * その際に `search/index.tsx` のローカル関数を削除し、こちらへ寄せること。
 * それまでは 2 箇所に同じ分岐が存在するので、文言を変えるときは**両方**直すこと。
 */
export function getCurrentLocationErrorMessage(kind: LocationPermissionErrorKind): string {
	switch (kind) {
		case "denied":
			return i18n.t("Search.errors.getCurrentLocationDenied");
		case "unsupported":
			return i18n.t("Search.errors.getCurrentLocationUnsupported");
		case "timeout":
			return i18n.t("Search.errors.getCurrentLocationTimeout");
		case "unavailable":
		default:
			return i18n.t("Search.errors.getCurrentLocation");
	}
}

/**
 * #932 【設計】手入力へフォーカス誘導すべき失敗か。
 *
 * 権限拒否（denied）と実行環境の非対応（unsupported）は、同じ操作を繰り返しても解決しない。
 * この 2 つのときだけ地点入力欄へフォーカスを移し、ユーザーを手入力へ誘導する。
 * timeout / unavailable は再試行で解決しうるので、フォーカスは奪わない
 * （現在地ボタンをもう一度押せる状態のままにする）。
 */
export function shouldFallbackToManualInput(kind: LocationPermissionErrorKind): boolean {
	return kind === "denied" || kind === "unsupported";
}

// #932 【設計】現在地取得の失敗理由を native/web 双方で共通の形に分類するための型・エラークラス。
// useCurrentLocationPosition.ts(native) と .web.ts(web) の両方がこの分類で throw し、
// 呼び出し側(useLocationSearch / 画面側)は理由別に文言・導線を出し分けられる。
export type LocationPermissionErrorKind =
	// 実行環境が位置情報取得に対応していない(例: ブラウザに geolocation API が無い)
	| "unsupported"
	// 権限が拒否されている
	| "denied"
	// 取得がタイムアウトした
	| "timeout"
	// 上記以外の理由で取得できなかった(端末側の位置情報サービスがOFF等)
	| "unavailable";

export class LocationPermissionError extends Error {
	readonly kind: LocationPermissionErrorKind;

	constructor(kind: LocationPermissionErrorKind, message: string) {
		super(message);
		this.name = "LocationPermissionError";
		this.kind = kind;
	}
}

import { ReactNode } from "react";

/**
 * 🗺️ Google Maps JavaScript API の読み込み状態（ネイティブ版 = 何もしない）
 *
 * ネイティブでは地図を `react-native-maps` が描画するので、外部スクリプトの読み込みは存在しない。
 * web 版（`GoogleMapsScript.web.tsx`）と同じ形の API をここに置いておくのは、
 * 呼び出し側（`components/MapView.web.tsx` など）が Platform 分岐を書かずに済むようにするためと、
 * TypeScript がこちらのファイルで型を解決するため。
 *
 * ⚠️ web 側の実装を変えるときは、この型が構造的に一致していることを保つこと。
 */
export type GoogleMapsScriptState = {
	/** 地図 API が使える状態か。ネイティブは常に true（待つ対象が無い） */
	isLoaded: boolean;
	/** 読み込みに失敗したときのエラー。ネイティブは常に undefined */
	loadError: Error | undefined;
};

/** ネイティブでは何も包まない（children をそのまま返す） */
export const GoogleMapsScriptProvider = ({ children }: { children: ReactNode }) => <>{children}</>;

/** ネイティブでは待つものが無いので、常に「読み込み済み」を返す */
export const useGoogleMapsScript = (): GoogleMapsScriptState => ({ isLoaded: true, loadError: undefined });

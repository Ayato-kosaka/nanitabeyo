import { ReactNode, Fragment } from "react";

/**
 * #938 【仕様】Google Maps JS SDK の読み込み管理は Web 専用(MapsLoaderContext.web.tsx)。
 * ネイティブは react-native-maps がネイティブ SDK を直接使うため読み込み待ちが不要で、
 * このファイルは import 解決用の no-op スタブとして存在する。
 */
export const MapsLoaderProvider = ({ children }: { children: ReactNode }) => {
	return <Fragment>{children}</Fragment>;
};

export const useMapsLoader = (): { isLoaded: boolean; loadError: Error | undefined } => {
	return { isLoaded: true, loadError: undefined };
};

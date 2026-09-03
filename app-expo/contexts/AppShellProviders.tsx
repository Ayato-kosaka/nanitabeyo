/*
#1810 【設計】`DialogProvider` → `AuthProvider` → `TrueSheetProvider` の入れ子順序をまとめたもの。

以前はここに `Portal.Host` と `MapsEmbedModalProvider` も含めていた。react-native-paper の
bare `<Portal>` は「JSX 上どこに書かれたか」ではなく「その `<Portal>` タグの位置から見て
一番近い祖先の `Portal.Host`」で解決されるため、`MapsEmbedModalProvider` の `<Portal>` が
`DialogContext` / `AuthContext` を継承できるかどうかがこの入れ子順序そのものに懸かっていた
（経緯は git 履歴のこのファイルの旧版コメント、および #1810 参照）。

#843 でアプリ内地図（旧 `MapsEmbedModal`）を Portal 経由の全画面オーバーレイから
expo-router のルート（`app/[locale]/maps-embed.tsx`）へ変えたことで、この Portal 越しの
Context 解決問題はそもそも起こらなくなった（通常の画面と同じ Provider ツリーの中でマウントされる）。
`Portal.Host` は元の置き場所（`app/[locale]/_layout.tsx`）へ戻した。

残った 3 つの並び順自体に依存関係は無いが、既存の入れ子をそのまま保つ。
*/
import React from "react";
import { TrueSheetProvider } from "@lodev09/react-native-true-sheet";
import { DialogProvider } from "@/contexts/DialogProvider";
import { AuthProvider } from "@/contexts/AuthProvider";

export function AppShellProviders({ children }: { children: React.ReactNode }) {
	return (
		<DialogProvider>
			<AuthProvider>
				<TrueSheetProvider>{children}</TrueSheetProvider>
			</AuthProvider>
		</DialogProvider>
	);
}

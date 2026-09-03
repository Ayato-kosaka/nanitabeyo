/*
#1810 【設計】`DialogProvider` → `AuthProvider` → `Portal.Host` → `MapsEmbedModalProvider` →
`TrueSheetProvider` の入れ子順序だけを切り出したもの。

## なぜここだけ切り出すか
react-native-paper の bare `<Portal>` は「JSX 上どこに書かれたか」ではなく「その `<Portal>`
タグの位置から見て一番近い祖先の `Portal.Host`」で解決される。`MapsEmbedModalProvider` /
`DialogProvider` 自身が持つ `<Portal>` は、それぞれの `{children}` と**同じ階層の兄弟**として
描かれる（`{children}<Portal>...</Portal>` という形）ため、`<Portal>` タグ自身は
自分の `{children}` の**内側**にはいない。

以前は `Portal.Host` が `AuthProvider` の内側・`MapsEmbedModalProvider` の `{children}` の
奥深くにあった。`MapsEmbedModalProvider` の `<Portal>` から見るとその `Portal.Host` は祖先ではなく
«甥»（別の枝）に当たるため見えず、結局もっと上の `PaperProvider` が自動生成する既定ホストへ
登ってしまっていた。そのホストは `DialogProvider` / `AuthProvider` より**外側**にあるため、
そこへ mount された `MapsEmbedModal`（`useAPICall` 経由で `useDialog()` / `useAuth()` を呼ぶ）は
「[useDialog] This hook must be used within a <DialogProvider>.」でマウント直後にクラッシュしていた
（`showMapsEmbedModal` を一度も呼ばなくても、`params` が null の間から再現する。
コンポーネント自体は毎回描画されフックは実行されるため）。

直したのは 2 点: (1) `Portal.Host` を `MapsEmbedModalProvider` の**外側**（＝その `<Portal>`
タグから見て確実に祖先になる場所）へ出す。(2) `AuthProvider` も同じ理由で
`MapsEmbedModalProvider` の**外側**へ出す（`AuthProvider` が `MapsEmbedModalProvider` の
`{children}` の内側にある限り、`Portal.Host` をどこに置いても `AuthContext` の祖先にはできない）。
両方とも `DialogProvider` の**内側**（＝各 Context の子孫であり続ける場所）に留める。

この不変条件は `AppShellProviders.test.tsx` が、モックなしの実プロバイダで
`MapsEmbedModal` を実際に開いて固定している。並び順を戻すとそこが赤くなる。
*/
import React from "react";
import { Portal } from "react-native-paper";
import { TrueSheetProvider } from "@lodev09/react-native-true-sheet";
import { DialogProvider } from "@/contexts/DialogProvider";
import { AuthProvider } from "@/contexts/AuthProvider";
import { MapsEmbedModalProvider } from "@/contexts/MapsEmbedModalProvider";

export function AppShellProviders({ children }: { children: React.ReactNode }) {
	return (
		<DialogProvider>
			<AuthProvider>
				<Portal.Host>
					<MapsEmbedModalProvider>
						<TrueSheetProvider>{children}</TrueSheetProvider>
					</MapsEmbedModalProvider>
				</Portal.Host>
			</AuthProvider>
		</DialogProvider>
	);
}

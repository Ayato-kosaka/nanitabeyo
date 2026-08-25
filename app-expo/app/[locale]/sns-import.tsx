/*
このファイルの責務
- 旧 `/{locale}/sns-import` を新しい `/{locale}/add-record` へ **転送するだけ**。

## なぜ残すのか

#1375（5 巡目）でこの画面を `add-record.tsx` へ改名した（＋ で開くシートは SNS 取り込みと
«食べたを記録» の 2 つを持つので、`sns-import` は片方しか指していなかった）。

改名しても、**すでに開かれた URL が消えるわけではない**。web ではブラウザの履歴・ブックマーク・
共有された古いリンクが残るし、`?url=` 付きで貼られた取り込みリンクもある。転送を置かないと
それらが «画面が見つかりません» に落ちる。10 行で防げる後退なので置く。

## クエリはそのまま渡す

`?url=<共有された投稿の URL>` は取り込みの入口そのものなので、落とすと転送する意味が無い。
*/
import { Redirect, useLocalSearchParams } from "expo-router";

export default function SnsImportRedirectScreen() {
	const { locale, url } = useLocalSearchParams<{ locale: string; url?: string }>();
	return (
		<Redirect
			href={{
				pathname: "/[locale]/add-record",
				params: { locale, ...(url ? { url } : {}) },
			}}
		/>
	);
}

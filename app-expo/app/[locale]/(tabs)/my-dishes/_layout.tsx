import { Stack } from "expo-router";
import { useThemedStackScreenOptions } from "@/hooks/useThemedStackScreenOptions";

/*
#1629 【修正】オーナー実機報告「端末設定の言語を変えると戻るボタンが効かなくなる」。

> 日本語から英語に変えると英語の端末設定画面になるんですけど、そこで戻るボタンを
> 押すと検索画面に飛ぶんですよ。もう一回プロフィール行くと言語を選択する画面に入って、
> そこから戻るボタンを押すと探すタブに行っちゃうので、**もうプロフィールには
> 二度と戻れない**っていうバグが発生してます。

言語切替は `router.replace("/en-US/profile/language")` で **ロケールごとナビゲート
し直す**（`app/[locale]/(tabs)/profile/language.tsx`）。このとき新しいロケールの
Stack は «その 1 画面» だけで組まれるため、戻る先が Stack の中に無い。
結果、戻るはタブナビゲータの初期タブ（＝検索）へ抜ける。

`initialRouteName` を宣言しておくと、深い URL へ直接着地したときに **index が
下に積まれた状態**で Stack が組まれるので、戻るが index へ帰る。

⚠️ deep link・言語切替・共有リンクからの着地がある Stack には**必ず**置くこと。
   search には元から在ったが、profile / my-dishes / notifications には無かった。
*/
export const unstable_settings = {
	initialRouteName: "index",
};

export default function MyDishesStackLayout() {
	// #1629【27】遷移中・モーダル背後に react-navigation 既定の明るいグレーが出るのを防ぐ
	const screenOptions = useThemedStackScreenOptions({ headerShown: false });
	return (
		<Stack screenOptions={screenOptions}>
			<Stack.Screen name="index" />
			<Stack.Screen name="select-restaurant" />
			{/*
			 * #1396 フィルタ編集は **ルート**にする（設計書 (2/2) §8-5）。
			 * BlurModal（旧オーバーレイ）で出すと、Portal.Host が <Stack> を包んでいるため
			 * 開いたまま push した遷移先が下に潜る（#1364 で実測）。
			 */}
			<Stack.Screen name="filters" />
			{/*
			 * #1397 (PR4/5) 全画面 Feed も **ルート**にする（設計 (2/2) §9-2）。
			 * 先例は `app/[locale]/(tabs)/notifications/feed.tsx`（タブの Stack の中のフィードルート）。
			 * presentation は指定しない（＝既定の card）ので、Android の戻る・ブラウザバック・
			 * URL 共有はすべて Navigator の既定挙動で賄える。
			 */}
			<Stack.Screen name="feed" />
		</Stack>
	);
}

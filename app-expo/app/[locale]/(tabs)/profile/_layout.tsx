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

export default function ProfileStackLayout() {
	// #1629【27】遷移中・モーダル背後に react-navigation 既定の明るいグレーが出るのを防ぐ
	const screenOptions = useThemedStackScreenOptions({ headerShown: false });
	return <Stack screenOptions={screenOptions} />;
}

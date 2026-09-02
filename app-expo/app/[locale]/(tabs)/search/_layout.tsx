import { Stack } from "expo-router";
import { useThemedStackScreenOptions } from "@/hooks/useThemedStackScreenOptions";

// deep link 時に Search Stack の戻り先として index を積む
export const unstable_settings = {
	initialRouteName: "index",
};

export default function SearchStackLayout() {
	// #1629【27】遷移中・モーダル背後に react-navigation 既定の明るいグレーが出るのを防ぐ
	const screenOptions = useThemedStackScreenOptions({ headerShown: false });
	return (
		<Stack screenOptions={screenOptions}>
			<Stack.Screen name="index" />
			<Stack.Screen name="dish-categories" />
			<Stack.Screen name="dish-category-group-votes" />
			{/*
			  #1629 【修正】オーナー実機報告「うどんが大きくなって、下からまたうどんが出てくる」。

			  「この料理にする！」を押すと、dish-categories 側の `DishCategoryCardExpandTransition` が
			  **カードを画面いっぱいまで広げる**。その完了後に result へ push するのだが、
			  この画面は `presentation: "transparentModal"` なので **既定で下からせり上がる**。
			  result の初期表示は同じ料理画像（`DishSelectionExpandLoading`）なので、
			  «広がり切った料理画像» の上に «同じ料理画像がもう一度下から出てくる» ことになる。

			  `animation: "fade"` にして、広がり切った絵からそのまま入れ替わるようにした。

			  ⚠️ `DishSelectionExpandLoading` 側は「ここで再度アニメーションさせると二重に動いて
			     見える」と分かっていて静的に描いている。見落としていたのは
			     **画面遷移そのものの既定アニメーション**だった。

			  ⚠️ `"none"` ではなく `"fade"`。この画面には拡大アニメーションを経由しない入口
			     （`dishImageUrl` を持たない遷移）もあり、そちらが «瞬間的に切り替わる» と雑に見える。
			  ⚠️ `presentation` は変えないこと。透過モーダルであることに依存した見せ方が別にある。
			*/}
			<Stack.Screen
				name="result"
				options={{ presentation: "transparentModal", headerShown: false, animation: "fade" }}
			/>
		</Stack>
	);
}

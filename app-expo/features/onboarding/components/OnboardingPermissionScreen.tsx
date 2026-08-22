/*
このファイルの責務
- 「なぜこの権限が要るのか」を説明しつつ、表示と同時に OS の許可ダイアログを出す画面（#1486 §5 / §6）。
- 許可 / 拒否のどちらでも、答えが出た時点で次へ進める。

位置情報と通知で違うのは「見出し・本文・どの許可を求めるか」だけなので、器はここに 1 つだけ持つ。

## なぜ «最低表示時間» を持つのか

`requestXxxPermissionsAsync()` は **すでに回答済みなら OS がダイアログを出さずに即座に返る**
（#1486 §5「すでに回答済みの場合はOS仕様に従い再表示しない」）。素直に「返ったら次へ」と書くと、
再インストール前に許可済みだった人や、2 回目以降の起動で説明画面が **一瞬光って消える**。
説明を読ませるための画面が読めないのでは意味が無いので、答えが出ても最低限は表示し続ける。
*/
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import type { PermissionOutcome } from "../permissions";

/** 答えが即座に返っても、説明文を読める程度には表示し続ける */
const MINIMUM_VISIBLE_MS = 1400;

/**
 * 万一 OS からの応答が返ってこなかったときの保険。
 *
 * ここに引っかかるのは「ダイアログが出たまま応答が来ない」ときだけで、通常は先に答えが返る。
 * 権限は «拒否されても止めない»（#1486 §9）ので、答えを待ち続けて画面に閉じ込めるより、
 * 待つのをやめて先へ進めるほうが要件に合う。ユーザーがその後ダイアログへ答えた結果は
 * OS 側に残るので、答え自体が失われるわけではない。
 */
const RESPONSE_TIMEOUT_MS = 30000;

export type OnboardingPermissionScreenProps = {
	title: string;
	body: string;
	/** OS の許可ダイアログを出す関数（features/onboarding/permissions.ts） */
	request: () => Promise<PermissionOutcome>;
	/** 答えが出た（あるいは待つのをやめた）ときに 1 度だけ呼ばれる */
	onSettled: (outcome: PermissionOutcome) => void;
	testID?: string;
};

export function OnboardingPermissionScreen({
	title,
	body,
	request,
	onSettled,
	testID,
}: OnboardingPermissionScreenProps) {
	// 進行は 1 回だけ。応答とタイムアウトが競っても二重に遷移させない
	const hasSettledRef = useRef(false);
	const [outcome, setOutcome] = useState<PermissionOutcome | null>(null);

	/**
	 * ⚠️ **`request` と `onSettled` を effect の依存に入れてはいけない。**
	 *
	 * 位置情報の画面（app/[locale]/onboarding/location.tsx）の `onSettled` は
	 * `useAuth()` の `user` / `isAuthResolved` に依存している。オンボーディングの最中は
	 * まさに認証が動いている時間帯（ログインした直後、あるいは匿名セッションの確立中）なので、
	 * **許可ダイアログを出している間に `onSettled` の識別子が変わる**ことが普通に起こる。
	 *
	 * 依存に入れると、そのたびに effect が張り直されて
	 * `requestForegroundPermissionsAsync()` が **もう一度呼ばれる**。
	 * `hasSettledRef` は «二重に次へ進む» ことは防ぐが、OS への二重要求は防げない。
	 *
	 * そこで最新の関数を ref に持ち、effect 自体は **マウント時に 1 回だけ**走らせる。
	 * 呼ぶ時点では ref の中身が最新なので、古い `onSettled` を呼んでしまうこともない。
	 */
	const requestRef = useRef(request);
	const onSettledRef = useRef(onSettled);
	requestRef.current = request;
	onSettledRef.current = onSettled;

	useEffect(() => {
		let isActive = true;

		const settle = (result: PermissionOutcome) => {
			if (!isActive || hasSettledRef.current) return;
			hasSettledRef.current = true;
			onSettledRef.current(result);
		};

		// #1486 §5 【設計】「画面表示と同時に許可ダイアログを表示する」。
		// 応答待ちと最低表示時間を **並行で** 走らせ、両方が済んでから次へ進む。
		// 直列（表示 → 待つ → 要求）にすると、ダイアログが出るまでの間だけ説明が浮いて見える
		const elapsed = new Promise<void>((resolve) => setTimeout(resolve, MINIMUM_VISIBLE_MS));

		const timeoutId = setTimeout(() => settle("unavailable"), RESPONSE_TIMEOUT_MS);

		void (async () => {
			const result = await requestRef.current();
			if (isActive) setOutcome(result);
			await elapsed;
			settle(result);
		})();

		return () => {
			isActive = false;
			clearTimeout(timeoutId);
		};
	}, []);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
				<View style={styles.content} testID={testID}>
					<Image
						source={require("@/assets/images/icon.webp")}
						style={styles.logo}
						contentFit="contain"
						accessibilityElementsHidden
						importantForAccessibility="no-hide-descendants"
					/>

					<Text style={styles.title} testID={testID ? `${testID}-title` : undefined}>
						{title}
					</Text>
					<Text style={styles.body} testID={testID ? `${testID}-body` : undefined}>
						{body}
					</Text>
				</View>

				{/* 応答待ちであることを示す。答えが出た後は «次の画面へ移る直前» なので消す */}
				<View style={styles.footer}>{outcome === null ? <LoadingIndicator size="small" /> : null}</View>
			</SafeAreaView>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	safeArea: {
		flex: 1,
	},
	content: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 32,
		gap: 16,
	},
	logo: {
		width: 88,
		height: 88,
		borderRadius: 20,
		marginBottom: 8,
	},
	title: {
		fontSize: 24,
		lineHeight: 34,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
	},
	body: {
		fontSize: 15,
		lineHeight: 24,
		color: "#4B5563",
		textAlign: "center",
	},
	footer: {
		height: 56,
		alignItems: "center",
		justifyContent: "center",
	},
});

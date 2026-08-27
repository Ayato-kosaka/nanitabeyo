/*
このファイルの責務
- 「なぜこの権限が要るのか」を説明しつつ、表示と同時に OS の許可ダイアログを出す画面（#1486 §5 / §6）。
- 許可 / 拒否のどちらでも、答えが出た時点で次へ進める。

位置情報と通知で違うのは「見出し・本文・どの許可を求めるか」だけなので、器はここに 1 つだけ持つ。

## 出す前に «出す価値があるか» を確かめる（probe）

`requestXxxPermissionsAsync()` は **すでに回答済みなら OS がダイアログを出さずに即座に返る**。
かつて «最低表示時間» で誤魔化していたが、「web で拒否済みだと画面が一瞬光って消える。
拒否されてるなら出ないべきでは」という指摘のとおり、**回答済みの人にこの画面を見せる理由が無い**。
そこでマウント直後に `probe`（ダイアログを出さずに状態だけ読む）を呼び、
`prompt` 以外なら **説明を描画すらせずに** 即座に次へ進む。

`prompt` のときだけ説明を描画し、同時に OS ダイアログを要求する。このときは
説明を読ませるために最低表示時間（MINIMUM_VISIBLE_MS）を併走させる。

## 中央の «ダミーダイアログ»

参考デザイン（SARAH）と同じく、中央には OS の許可ダイアログを模した **ダミー** を置き、
おすすめの選択肢を枠で強調する。実物のダイアログはこのダミーの上へ重なって出るので、
ユーザーは「どれを押せばいいか」を実物が出る前・出た後の両方で確認できる。
ダミーは装飾なので、タップも読み上げも受けない。
*/
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import type { PermissionOutcome, PermissionPromptState } from "../permissions";

/** 答えが即座に返っても、説明文を読める程度には表示し続ける */
const MINIMUM_VISIBLE_MS = 1400;

/**
 * «ダイアログを出さずに即答された» とみなす猶予。
 *
 * probe（permissions.query 等）が `prompt` を返しても、実際に要求すると **ダイアログを
 * 出さずに即座に拒否が返る**環境がある（プライベートブラウジング、OS レベルで位置情報が
 * 切られている端末など）。probe を信じて説明画面を描くと「一瞬出てすぐ消える」が再発する
 *（実機検収で再報告された）ので、要求を先に投げ、この猶予内に答えが返ったら
 * **回答済みと同じ扱い**にして描画せずに次へ進む。
 *
 * 人間がダイアログを読んで答えるのに 400ms では足りないため、
 * 本当にダイアログが出ている場合をここで取り違えることはない。
 */
const INSTANT_SETTLE_GRACE_MS = 400;

/**
 * 万一 OS からの応答が返ってこなかったときの保険。
 *
 * ここに引っかかるのは「ダイアログが出たまま応答が来ない」ときだけで、通常は先に答えが返る。
 * 権限は «拒否されても止めない»（#1486 §9）ので、答えを待ち続けて画面に閉じ込めるより、
 * 待つのをやめて先へ進めるほうが要件に合う。ユーザーがその後ダイアログへ答えた結果は
 * OS 側に残るので、答え自体が失われるわけではない。
 */
const RESPONSE_TIMEOUT_MS = 30000;

/** 中央に置く «OS ダイアログのダミー» の中身。実物と同じ並び順で渡すこと */
export type PermissionDialogPreview = {
	title: string;
	message: string;
	/** emphasized はおすすめの選択肢。ブランド色の枠で強調される */
	buttons: { label: string; emphasized?: boolean }[];
};

export type OnboardingPermissionScreenProps = {
	title: string;
	body: string;
	/** 上部プログレスバーの進捗（0〜1）。オンボーディング全体のどこまで来たかを示す */
	progress: number;
	/** ダイアログを出さずに «これから出せるか» を読む関数（features/onboarding/permissions.ts） */
	probe: () => Promise<PermissionPromptState>;
	/** OS の許可ダイアログを出す関数（features/onboarding/permissions.ts） */
	request: () => Promise<PermissionOutcome>;
	/** 中央に描く OS ダイアログのダミー */
	dialogPreview: PermissionDialogPreview;
	/** 答えが出た（あるいは待つのをやめた）ときに 1 度だけ呼ばれる */
	onSettled: (outcome: PermissionOutcome) => void;
	testID?: string;
};

export function OnboardingPermissionScreen({
	title,
	body,
	progress,
	probe,
	request,
	dialogPreview,
	onSettled,
	testID,
}: OnboardingPermissionScreenProps) {
	const styles = useThemedStyles(createStyles);
	// 進行は 1 回だけ。応答とタイムアウトが競っても二重に遷移させない
	const hasSettledRef = useRef(false);
	// probe が「これから尋ねられる」と言い、かつ要求が即答で返らなかった（= ダイアログが
	// 本当に出ている）ことが確認できるまでは何も描かない（回答済みの人に一瞬見せない）
	const [isAskable, setIsAskable] = useState(false);
	const [outcome, setOutcome] = useState<PermissionOutcome | null>(null);

	/**
	 * ⚠️ **`probe` / `request` / `onSettled` を effect の依存に入れてはいけない。**
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
	const probeRef = useRef(probe);
	const requestRef = useRef(request);
	const onSettledRef = useRef(onSettled);
	probeRef.current = probe;
	requestRef.current = request;
	onSettledRef.current = onSettled;

	useEffect(() => {
		let isActive = true;

		const settle = (result: PermissionOutcome) => {
			if (!isActive || hasSettledRef.current) return;
			hasSettledRef.current = true;
			onSettledRef.current(result);
		};

		const timeoutId = setTimeout(() => settle("unavailable"), RESPONSE_TIMEOUT_MS);

		void (async () => {
			// 回答済み（または尋ねられない環境）なら、この画面を見せる意味が無い。
			// 最低表示時間も待たず、説明も描かずに即座に次へ進む（web の «一瞬光って消える» 対策）
			const state = await probeRef.current();
			if (!isActive) return;
			if (state !== "prompt") {
				settle(state === "granted" ? "granted" : state === "denied" ? "denied" : "unavailable");
				return;
			}

			// #1486 §5 【設計】「画面表示と同時に許可ダイアログを表示する」ため要求を先に投げる。
			// ただし probe が `prompt` と言っても即答で返る環境がある（上の GRACE 定数のコメント参照）
			// ので、猶予内に答えが返ったら説明を描かずにそのまま次へ進む
			const requestPromise = requestRef.current();
			const GRACE = Symbol("grace");
			const early = await Promise.race([
				requestPromise,
				new Promise<typeof GRACE>((resolve) => setTimeout(() => resolve(GRACE), INSTANT_SETTLE_GRACE_MS)),
			]);
			if (!isActive) return;
			if (early !== GRACE) {
				settle(early);
				return;
			}

			// ダイアログが本当に出ている。ここで初めて説明画面を描画する。
			// 応答待ちと最低表示時間を **並行で** 走らせ、両方が済んでから次へ進む。
			// 直列（表示 → 待つ → 要求）にすると、ダイアログが出るまでの間だけ説明が浮いて見える
			setIsAskable(true);
			const elapsed = new Promise<void>((resolve) => setTimeout(resolve, MINIMUM_VISIBLE_MS));
			const result = await requestPromise;
			if (isActive) setOutcome(result);
			await elapsed;
			settle(result);
		})();

		return () => {
			isActive = false;
			clearTimeout(timeoutId);
		};
	}, []);

	// probe の結果待ち（数十 ms）。遷移アニメーション中の背景と同じ面を敷くだけに留める
	if (!isAskable) return <View style={styles.container} />;

	return (
		<View style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
				{/* 上部プログレスバー。導線のどこまで来たかを常に見せる（参考デザインの構成） */}
				<View style={styles.progressTrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
					<View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
				</View>

				<View style={styles.content} testID={testID}>
					<Text style={styles.title} testID={testID ? `${testID}-title` : undefined}>
						{title}
					</Text>
					<Text style={styles.body} testID={testID ? `${testID}-body` : undefined}>
						{body}
					</Text>
				</View>

				{/* 中央の «ダミーダイアログ»。実物の OS ダイアログはこの上へ重なって出る。
				    装飾なのでタップも読み上げも受けない */}
				<View
					style={styles.dialogArea}
					pointerEvents="none"
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants">
					<MockPermissionDialog preview={dialogPreview} />
				</View>

				{/* 応答待ちであることを示す。答えが出た後は «次の画面へ移る直前» なので消す */}
				<View style={styles.footer}>{outcome === null ? <LoadingIndicator size="small" /> : null}</View>
			</SafeAreaView>
		</View>
	);
}

/**
 * OS の許可ダイアログを模したダミー。iOS のアラートの寸法感（幅 270・角丸 14・
 * 区切り線 hairline）に寄せ、おすすめの選択肢だけブランド色の枠で囲む。
 *
 * ボタンが 2 個なら実物（通知ダイアログ）と同じ横並び、3 個なら縦積み（位置情報ダイアログ）。
 */
function MockPermissionDialog({ preview }: { preview: PermissionDialogPreview }) {
	const styles = useThemedStyles(createStyles);
	const isHorizontal = preview.buttons.length === 2;

	return (
		<View style={styles.dialog}>
			<Text style={styles.dialogTitle}>{preview.title}</Text>
			<Text style={styles.dialogMessage}>{preview.message}</Text>

			<View style={isHorizontal ? styles.dialogButtonRow : undefined}>
				{preview.buttons.map((button, index) => (
					<View key={button.label} style={[styles.dialogButton, isHorizontal && styles.dialogButtonHorizontal]}>
						{/* 区切り線はセル側の上辺 / 左辺として引く（先頭のセルにも本文との区切りが要る） */}
						<View style={[styles.dialogSeparator, isHorizontal && index > 0 && styles.dialogSeparatorVertical]} />
						<View style={styles.dialogButtonInner}>
							<Text style={[styles.dialogButtonLabel, button.emphasized && styles.dialogButtonLabelEmphasized]}>
								{button.label}
							</Text>
						</View>
						{button.emphasized ? <View style={styles.dialogEmphasisRing} /> : null}
					</View>
				))}
			</View>
		</View>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: c.surface,
		},
		safeArea: {
			flex: 1,
		},
		progressTrack: {
			height: 8,
			marginTop: 16,
			backgroundColor: c.brandTrack,
			overflow: "hidden",
		},
		progressFill: {
			height: "100%",
			backgroundColor: c.brand,
			borderTopRightRadius: 4,
			borderBottomRightRadius: 4,
		},
		// 見出しと本文は «上部» に置く（中央ではない）。中央はダミーダイアログの居場所
		content: {
			paddingTop: 48,
			paddingHorizontal: 28,
			gap: 20,
		},
		title: {
			fontSize: 26,
			lineHeight: 40,
			fontWeight: "700",
			color: c.textPrimary,
			textAlign: "center",
		},
		body: {
			fontSize: 15,
			lineHeight: 26,
			color: c.textSecondaryAlt,
			textAlign: "center",
		},
		dialogArea: {
			flex: 1,
			alignItems: "center",
			justifyContent: "center",
		},
		// iOS アラートの寸法感。背景はすりガラスの代わりの薄いグレー、影は控えめに。
		// 色は alert* トークン（= OS アラートのシステム値。constants/Palette.ts のコメント参照）
		dialog: {
			width: 270,
			borderRadius: 14,
			backgroundColor: c.alertSurface,
			overflow: "hidden",
			shadowColor: FixedColors.shadow,
			shadowOpacity: 0.18,
			shadowRadius: 24,
			shadowOffset: { width: 0, height: 8 },
			elevation: 8,
		},
		dialogTitle: {
			fontSize: 16,
			lineHeight: 22,
			fontWeight: "600",
			color: c.textPrimary,
			textAlign: "center",
			paddingTop: 19,
			paddingHorizontal: 16,
		},
		dialogMessage: {
			fontSize: 13,
			lineHeight: 18,
			color: c.alertMessage,
			textAlign: "center",
			paddingTop: 4,
			paddingHorizontal: 16,
			paddingBottom: 19,
		},
		dialogButtonRow: {
			flexDirection: "row",
		},
		dialogButton: {
			height: 44,
		},
		dialogButtonHorizontal: {
			flex: 1,
		},
		dialogButtonInner: {
			flex: 1,
			alignItems: "center",
			justifyContent: "center",
		},
		dialogSeparator: {
			position: "absolute",
			top: 0,
			left: 0,
			right: 0,
			height: StyleSheet.hairlineWidth,
			backgroundColor: c.alertSeparator,
		},
		dialogSeparatorVertical: {
			right: undefined,
			bottom: 0,
			height: "100%",
			width: StyleSheet.hairlineWidth,
		},
		dialogButtonLabel: {
			fontSize: 17,
			color: c.alertAction,
		},
		dialogButtonLabelEmphasized: {
			fontWeight: "600",
		},
		// おすすめの選択肢を囲むブランド色の枠（参考デザインの «ここを押してね» 表現）
		dialogEmphasisRing: {
			position: "absolute",
			top: 4,
			left: 4,
			right: 4,
			bottom: 4,
			borderWidth: 2,
			borderColor: c.brand,
			borderRadius: 9,
		},
		footer: {
			justifyContent: "flex-end",
			alignItems: "center",
			paddingBottom: 32,
		},
	});

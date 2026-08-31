/**
 * 🚩 コンテンツを通報するシート（#1514 / SAF-01）
 *
 * ## 責務
 * 「理由を選ぶ → 送る → 受け付けたことを伝える」の 3 状態だけを持つ。
 * 審査の進捗も、通報した対象が今どうなっているかも見せない
 * （オーナー確定仕様: 通報後は「受け付けました」と返すだけ。審査結果の通知はスコープ外）。
 *
 * ## 投稿とレビューで 1 つのコンポーネントを使い回す
 * 通報の対象は投稿（`dish_media`）とレビュー（`dish_reviews`）の 2 つあるが、
 * **理由の集合・送信先・重複時の見え方・受付後の文面はすべて同じ**である。
 * 対象ごとにシートを分けると、理由を 1 つ足すたびに 2 箇所を直すことになり、
 * 片方だけ古い選択肢が残る事故を招く。差分は
 * 「見出しと読み上げラベル（= `TARGET_COPY`）」と「送信する `targetType`」だけに閉じてある。
 *
 * ## 通報しても対象は消えない・隠れない
 * 通報を即時非表示に繋ぐと、通報爆撃がそのまま検閲の道具になる。
 * したがってこのシートは `useDishMediaEntriesStore` を一切更新しない。
 * 送信後もフィードの見た目は変わらないのが正しい。
 *
 * ## 重複通報のとき
 * API は 2 回目以降を 409 にせず、既存の受付番号を返す（冪等）。
 * UI はその差を出さない。「あなたは既に通報済みです」と伝えると、
 * 通報したこと自体が端末を触れる人に見えてしまう。
 */
import React, { useCallback, useMemo, useState } from "react";
import {
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from "react-native";
import { Check, CircleCheck, Flag, X } from "lucide-react-native";

import { useRouter } from "expo-router";

import { PrimaryButton } from "@/components/PrimaryButton";
// #1514 このシートはフィード（常に暗いメディア面）の上ではなく «画面の面» として開くため、
// メディア用の FixedColors ではなくテーマ追従のトークンを使う
import type { Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { useHaptics } from "@/hooks/useHaptics";
import { useSheetBottomPadding } from "@/hooks/useSheetBottomPadding";
import { useLocale } from "@/hooks/useLocale";
import { toErrorLogMessage } from "@/lib/errorMessage";
import type { CreateContentReportDto } from "@shared/api/v1/dto";
import type { CreateContentReportResponse } from "@shared/api/v1/res";
import {
	CONTENT_REPORT_REASON_CODES,
	CONTENT_REPORT_REASON_TEXT_MAX_LENGTH,
	type ContentReportReasonCode,
	type ContentReportTargetType,
} from "@shared/api/v1/constants/contentReports";

/**
 * 対象種別ごとに変わる文言のキー。
 *
 * ⚠️ **ここ以外に種別分岐を増やさないこと。** 選択肢・送信処理・受付後の面まで
 * 分岐が広がると「投稿では直したのにレビューでは直っていない」が起きる。
 * 種別を増やすときは `ContentReportTargetType` に足せば、この Record が
 * 網羅を強制する（キー漏れがコンパイルエラーになる）。
 */
const TARGET_COPY: Record<ContentReportTargetType, { title: string; submitAccessibilityLabel: string }> = {
	dish_media: {
		title: "Report.title",
		submitAccessibilityLabel: "Report.accessibility.submit",
	},
	dish_reviews: {
		title: "Report.reviewTitle",
		submitAccessibilityLabel: "Report.accessibility.submitReview",
	},
};

interface ReportContentSheetProps {
	/** シートを開いているか */
	visible: boolean;
	/** 通報対象の種別。投稿（`dish_media`）かレビュー（`dish_reviews`） */
	targetType: ContentReportTargetType;
	/** 通報対象の ID。`targetType` が示すテーブルの主キー */
	targetId: string;
	/**
	 * 通報対象が «どれか» を読み上げるための名前。
	 * 投稿なら店舗名、レビューなら書いた人の表示名。
	 */
	targetLabel: string;
	/** 閉じる（キャンセル・完了のいずれでも呼ばれる） */
	onClose: () => void;
}

/** シートの状態。`accepted` まで来たら理由の選択には戻さない */
type Phase = "form" | "submitting" | "accepted";

/** シート下端のデザイン上の余白。実際の余白はこれに safe area の inset を足したもの */
const SHEET_PADDING_BOTTOM = 28;

export function ReportContentSheet({ visible, targetType, targetId, targetLabel, onClose }: ReportContentSheetProps) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();
	// #1742 Modal はネイティブでは別ウィンドウで、画面側の safe area が届かない。
	// 足さないと送信ボタンが Android のナビゲーションバーへ潜る（hooks/useSheetBottomPadding.ts）
	const sheetPaddingBottom = useSheetBottomPadding(SHEET_PADDING_BOTTOM);

	const [phase, setPhase] = useState<Phase>("form");
	const [reasonCode, setReasonCode] = useState<ContentReportReasonCode | null>(null);
	const [reasonText, setReasonText] = useState("");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	// 理由の並び順は shared の定数がそのまま表示順（`other` が最後）。
	// 画面側で並べ替えると、API・DB・UI の 3 箇所で順番の解釈が割れる。
	// 投稿とレビューで同じ集合を出す（種別ごとに絞り込まない）
	const reasons = useMemo(() => CONTENT_REPORT_REASON_CODES, []);

	const copy = TARGET_COPY[targetType];

	/** 閉じるときに状態を初期化する。次に開いたとき前回の選択が残っていると誤送信になる */
	const handleClose = useCallback(() => {
		setPhase("form");
		setReasonCode(null);
		setReasonText("");
		setErrorMessage(null);
		onClose();
	}, [onClose]);

	const handleSubmit = useCallback(async () => {
		// 理由未選択では送信ボタンを disabled にしているが、
		// 連打・再入を同期的に弾く意味でもここで確認する
		if (!reasonCode || phase === "submitting") return;

		lightImpact();
		setPhase("submitting");
		setErrorMessage(null);

		try {
			const response = await callBackend<CreateContentReportDto, CreateContentReportResponse>("v1/content-reports", {
				method: "POST",
				requestPayload: {
					targetType,
					targetId,
					reasonCode,
					// 空文字は送らない（API 側でも trim して null にするが、
					// 「入力していない」を「空文字を入力した」として送る理由が無い）
					...(reasonText.trim() ? { reasonText: reasonText.trim() } : {}),
				},
			});

			// ⚠️ **payload に reasonText を入れないこと。** 自由記述には第三者の個人情報が
			// 書かれうる。フロントのログは BigQuery まで流れるので、理由コードまでに留める。
			//
			// イベント名は種別に依らず 1 つにして、種別は payload の targetType で分ける。
			// 種別ごとにイベント名を割ると、「通報が何件あったか」を数えるだけで
			// 名前の一覧を先に知っていないといけなくなる（種別を足すたび集計も直す）
			logFrontendEvent({
				event_name: "content_reported",
				error_level: "log",
				payload: {
					targetType,
					targetId,
					reasonCode,
					hasReasonText: reasonText.trim().length > 0,
					alreadyReported: response.alreadyReported,
				},
			});

			setPhase("accepted");
		} catch (error) {
			logFrontendEvent({
				event_name: "content_report_failed",
				error_level: "warn",
				payload: { targetType, targetId, reasonCode, error: toErrorLogMessage(error) },
			});
			// 失敗しても選択内容は残す。もう一度「報告する」を押せば送り直せる
			setErrorMessage(i18n.t("Report.errors.submitFailed"));
			setPhase("form");
		}
	}, [callBackend, lightImpact, logFrontendEvent, phase, reasonCode, reasonText, targetId, targetType]);

	return (
		<Modal
			visible={visible}
			transparent
			animationType="slide"
			onRequestClose={handleClose}
			// Android の戻るキー・iOS のスワイプでも状態が残らないよう handleClose に寄せる
			accessibilityViewIsModal>
			{/*
				#1629 **`<Modal>` の中は親のキーボード回避が届かない。**
				Modal はネイティブでは別ウィンドウとして描かれるので、画面側に
				KeyboardAvoidingView を置いても中の入力欄は守られない。
				さらに Android 15（API 35）は edge-to-edge 強制で adjustResize が
				窓を縮めなくなるため、OS 任せの逃げ道も無い。ここに自前で持つ。
				*/}
			<KeyboardAvoidingView style={styles.backdrop} behavior={Platform.select({ ios: "padding", android: "height" })}>
				{/* 背景タップで閉じる。送信中だけは閉じさせない（送信結果を見せる前に消さない） */}
				<Pressable
					style={styles.backdropTouchable}
					onPress={phase === "submitting" ? undefined : handleClose}
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
				/>

				<View style={[styles.sheet, { paddingBottom: sheetPaddingBottom }]} testID="report-sheet">
					{phase === "accepted" ? (
						<AcceptedView onClose={handleClose} />
					) : (
						<>
							<View style={styles.header}>
								<Flag size={18} color={colors.danger} />
								<Text style={styles.title}>{i18n.t(copy.title)}</Text>
								<TouchableOpacity
									onPress={handleClose}
									disabled={phase === "submitting"}
									hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
									accessibilityRole="button"
									accessibilityLabel={i18n.t("Common.close")}
									testID="report-cancel">
									<X size={20} color={colors.textSecondary} />
								</TouchableOpacity>
							</View>

							<Text style={styles.description}>{i18n.t("Report.description")}</Text>

							<ScrollView style={styles.reasonList} keyboardShouldPersistTaps="handled">
								{reasons.map((code) => {
									const selected = code === reasonCode;
									return (
										<TouchableOpacity
											key={code}
											style={[styles.reasonRow, selected && styles.reasonRowSelected]}
											onPress={() => setReasonCode(code)}
											accessibilityRole="radio"
											// #1031 と同じ考え方: 選択状態は色でしか出ていないと Detox から読めないので、
											// aria-selected と «状態別のラベル» の両方で観測できるようにする
											aria-selected={selected}
											accessibilityLabel={i18n.t(
												selected ? "Report.accessibility.reasonSelected" : "Report.accessibility.reason",
												{ reason: i18n.t(`Report.reasons.${code}`) },
											)}
											testID={`report-reason-${code}`}>
											<Text style={[styles.reasonLabel, selected && styles.reasonLabelSelected]}>
												{i18n.t(`Report.reasons.${code}`)}
											</Text>
											{selected ? <Check size={18} color={colors.danger} /> : null}
										</TouchableOpacity>
									);
								})}

								<Text style={styles.detailsLabel}>{i18n.t("Report.detailsLabel")}</Text>
								<TextInput
									style={styles.detailsInput}
									value={reasonText}
									onChangeText={setReasonText}
									placeholder={i18n.t("Report.detailsPlaceholder")}
									placeholderTextColor={colors.textTertiary}
									multiline
									// DB の CHECK（1000 文字）と同じ上限。ここで止めておけば
									// 「長文を書ききってから 400 で弾かれる」体験にならない
									maxLength={CONTENT_REPORT_REASON_TEXT_MAX_LENGTH}
									accessibilityLabel={i18n.t("Report.detailsLabel")}
									testID="report-details-input"
								/>
							</ScrollView>

							{errorMessage ? (
								<Text style={styles.error} testID="report-error">
									{errorMessage}
								</Text>
							) : null}

							<PrimaryButton
								label={i18n.t(phase === "submitting" ? "Report.submitting" : "Report.submit")}
								onPress={handleSubmit}
								loading={phase === "submitting"}
								disabled={!reasonCode || phase === "submitting"}
								colors={[colors.dangerStrong, colors.danger]}
								shadowColor={colors.danger}
								accessibilityLabel={i18n.t(copy.submitAccessibilityLabel, { name: targetLabel })}
								testID="report-submit"
							/>
						</>
					)}
				</View>
			</KeyboardAvoidingView>
		</Modal>
	);
}

/**
 * 受付完了の面。
 *
 * 受付番号（reportId）は出さない。問い合わせ窓口が無い今それを見せても使い道が無く、
 * 「番号があるなら進捗が見られるはず」という誤解だけが残る。
 */
function AcceptedView({ onClose }: { onClose: () => void }) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	const router = useRouter();
	const { locale } = useLocale();

	/**
	 * #1584 履歴へ移動する前にシートを閉じる。開いたままだと、戻ってきたときに
	 * 受付完了の面が残り「もう一度送れるのか」と読めてしまう。
	 */
	const handleOpenHistory = useCallback(() => {
		onClose();
		router.push({ pathname: "/[locale]/(tabs)/profile/content-reports", params: { locale } });
	}, [onClose, router, locale]);

	return (
		<View style={styles.accepted} testID="report-accepted">
			<CircleCheck size={44} color={colors.success} />
			<Text style={styles.acceptedTitle}>{i18n.t("Report.accepted.title")}</Text>
			<Text style={styles.acceptedDescription}>{i18n.t("Report.accepted.description")}</Text>
			<PrimaryButton
				label={i18n.t("Report.accepted.close")}
				onPress={onClose}
				style={styles.acceptedButton}
				testID="report-accepted-close"
			/>
			{/* #1584 主導線は «閉じる» なので、履歴は控えめな文字ボタンにする */}
			<TouchableOpacity onPress={handleOpenHistory} accessibilityRole="link" testID="report-accepted-history">
				<Text style={styles.acceptedHistoryLink}>{i18n.t("Report.accepted.history")}</Text>
			</TouchableOpacity>
		</View>
	);
}

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		backdrop: {
			flex: 1,
			justifyContent: "flex-end",
			backgroundColor: "rgba(0, 0, 0, 0.45)",
		},
		backdropTouchable: {
			...StyleSheet.absoluteFillObject,
		},
		sheet: {
			backgroundColor: colors.surface,
			borderTopLeftRadius: 20,
			borderTopRightRadius: 20,
			paddingHorizontal: 20,
			paddingTop: 16,
			// paddingBottom は safe area を足すため呼び出し側で組む（SHEET_PADDING_BOTTOM）
			maxHeight: "85%",
		},
		header: {
			flexDirection: "row",
			alignItems: "center",
			gap: 8,
		},
		title: {
			flex: 1,
			fontSize: 17,
			fontWeight: "700",
			color: colors.textPrimaryAlt,
		},
		description: {
			marginTop: 8,
			fontSize: 13,
			lineHeight: 19,
			color: colors.textSecondary,
		},
		reasonList: {
			marginTop: 12,
			marginBottom: 12,
		},
		reasonRow: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			paddingVertical: 13,
			paddingHorizontal: 14,
			borderRadius: 12,
			borderWidth: 1,
			borderColor: colors.borderMuted,
			marginBottom: 8,
		},
		reasonRowSelected: {
			borderColor: colors.danger,
			backgroundColor: colors.dangerTint,
		},
		reasonLabel: {
			fontSize: 15,
			color: colors.textPrimaryAlt,
		},
		reasonLabelSelected: {
			color: colors.danger,
			fontWeight: "600",
		},
		detailsLabel: {
			marginTop: 8,
			marginBottom: 6,
			fontSize: 13,
			fontWeight: "600",
			color: colors.textSecondaryStrong,
		},
		detailsInput: {
			minHeight: 80,
			borderWidth: 1,
			borderColor: colors.borderMuted,
			borderRadius: 12,
			padding: 12,
			fontSize: 14,
			color: colors.textPrimaryAlt,
			textAlignVertical: "top",
		},
		error: {
			marginBottom: 10,
			fontSize: 13,
			color: colors.danger,
		},
		accepted: {
			alignItems: "center",
			paddingVertical: 12,
			gap: 10,
		},
		acceptedTitle: {
			fontSize: 17,
			fontWeight: "700",
			color: colors.textPrimaryAlt,
		},
		acceptedDescription: {
			fontSize: 13,
			lineHeight: 19,
			color: colors.textSecondary,
			textAlign: "center",
		},
		acceptedButton: {
			marginTop: 8,
			alignSelf: "stretch",
		},
		// #1584 履歴への導線。主導線は «閉じる» なので、こちらは控えめな文字ボタンにする
		acceptedHistoryLink: {
			marginTop: 12,
			fontSize: 14,
			fontWeight: "600",
			color: colors.textSecondary,
			textDecorationLine: "underline",
		},
	});

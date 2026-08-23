/**
 * 🚩 投稿を通報するシート（#1514 / SAF-01）
 *
 * ## 責務
 * 「理由を選ぶ → 送る → 受け付けたことを伝える」の 3 状態だけを持つ。
 * 審査の進捗も、通報した投稿が今どうなっているかも見せない
 * （オーナー確定仕様: 通報後は「受け付けました」と返すだけ。審査結果の通知はスコープ外）。
 *
 * ## 通報しても投稿は消えない・隠れない
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
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Check, CircleCheck, Flag, X } from "lucide-react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { useHaptics } from "@/hooks/useHaptics";
import { toErrorLogMessage } from "@/lib/errorMessage";
import type { CreateContentReportDto } from "@shared/api/v1/dto";
import type { CreateContentReportResponse } from "@shared/api/v1/res";
import {
	CONTENT_REPORT_REASON_CODES,
	CONTENT_REPORT_REASON_TEXT_MAX_LENGTH,
	type ContentReportReasonCode,
} from "@shared/api/v1/constants/contentReports";

interface ReportDishMediaSheetProps {
	/** シートを開いているか */
	visible: boolean;
	/** 通報対象の投稿 ID */
	dishMediaId: string;
	/** 通報対象が «どの投稿か» を読み上げるための店舗名 */
	restaurantName: string;
	/** 閉じる（キャンセル・完了のいずれでも呼ばれる） */
	onClose: () => void;
}

/** シートの状態。`accepted` まで来たら理由の選択には戻さない */
type Phase = "form" | "submitting" | "accepted";

export function ReportDishMediaSheet({ visible, dishMediaId, restaurantName, onClose }: ReportDishMediaSheetProps) {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();

	const [phase, setPhase] = useState<Phase>("form");
	const [reasonCode, setReasonCode] = useState<ContentReportReasonCode | null>(null);
	const [reasonText, setReasonText] = useState("");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	// 理由の並び順は shared の定数がそのまま表示順（`other` が最後）。
	// 画面側で並べ替えると、API・DB・UI の 3 箇所で順番の解釈が割れる
	const reasons = useMemo(() => CONTENT_REPORT_REASON_CODES, []);

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
					targetType: "dish_media",
					targetId: dishMediaId,
					reasonCode,
					// 空文字は送らない（API 側でも trim して null にするが、
					// 「入力していない」を「空文字を入力した」として送る理由が無い）
					...(reasonText.trim() ? { reasonText: reasonText.trim() } : {}),
				},
			});

			// ⚠️ **payload に reasonText を入れないこと。** 自由記述には第三者の個人情報が
			// 書かれうる。フロントのログは BigQuery まで流れるので、理由コードまでに留める
			logFrontendEvent({
				event_name: "dish_media_reported",
				error_level: "log",
				payload: {
					dishMediaId,
					reasonCode,
					hasReasonText: reasonText.trim().length > 0,
					alreadyReported: response.alreadyReported,
				},
			});

			setPhase("accepted");
		} catch (error) {
			logFrontendEvent({
				event_name: "dish_media_report_failed",
				error_level: "warn",
				payload: { dishMediaId, reasonCode, error: toErrorLogMessage(error) },
			});
			// 失敗しても選択内容は残す。もう一度「報告する」を押せば送り直せる
			setErrorMessage(i18n.t("Report.errors.submitFailed"));
			setPhase("form");
		}
	}, [callBackend, dishMediaId, lightImpact, logFrontendEvent, phase, reasonCode, reasonText]);

	return (
		<Modal
			visible={visible}
			transparent
			animationType="slide"
			onRequestClose={handleClose}
			// Android の戻るキー・iOS のスワイプでも状態が残らないよう handleClose に寄せる
			accessibilityViewIsModal>
			<View style={styles.backdrop}>
				{/* 背景タップで閉じる。送信中だけは閉じさせない（送信結果を見せる前に消さない） */}
				<Pressable
					style={styles.backdropTouchable}
					onPress={phase === "submitting" ? undefined : handleClose}
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
				/>

				<View style={styles.sheet} testID="report-sheet">
					{phase === "accepted" ? (
						<AcceptedView onClose={handleClose} />
					) : (
						<>
							<View style={styles.header}>
								<Flag size={18} color="#DC2626" />
								<Text style={styles.title}>{i18n.t("Report.title")}</Text>
								<TouchableOpacity
									onPress={handleClose}
									disabled={phase === "submitting"}
									hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
									accessibilityRole="button"
									accessibilityLabel={i18n.t("Common.close")}
									testID="report-cancel">
									<X size={20} color="#6B7280" />
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
											{selected ? <Check size={18} color="#DC2626" /> : null}
										</TouchableOpacity>
									);
								})}

								<Text style={styles.detailsLabel}>{i18n.t("Report.detailsLabel")}</Text>
								<TextInput
									style={styles.detailsInput}
									value={reasonText}
									onChangeText={setReasonText}
									placeholder={i18n.t("Report.detailsPlaceholder")}
									placeholderTextColor="#9CA3AF"
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
								colors={["#EF4444", "#DC2626"]}
								shadowColor="#DC2626"
								accessibilityLabel={i18n.t("Report.accessibility.submit", { name: restaurantName })}
								testID="report-submit"
							/>
						</>
					)}
				</View>
			</View>
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
	return (
		<View style={styles.accepted} testID="report-accepted">
			<CircleCheck size={44} color="#16A34A" />
			<Text style={styles.acceptedTitle}>{i18n.t("Report.accepted.title")}</Text>
			<Text style={styles.acceptedDescription}>{i18n.t("Report.accepted.description")}</Text>
			<PrimaryButton
				label={i18n.t("Report.accepted.close")}
				onPress={onClose}
				style={styles.acceptedButton}
				testID="report-accepted-close"
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	backdrop: {
		flex: 1,
		justifyContent: "flex-end",
		backgroundColor: "rgba(0, 0, 0, 0.45)",
	},
	backdropTouchable: {
		...StyleSheet.absoluteFillObject,
	},
	sheet: {
		backgroundColor: "#FFFFFF",
		borderTopLeftRadius: 20,
		borderTopRightRadius: 20,
		paddingHorizontal: 20,
		paddingTop: 16,
		paddingBottom: 28,
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
		color: "#111827",
	},
	description: {
		marginTop: 8,
		fontSize: 13,
		lineHeight: 19,
		color: "#6B7280",
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
		borderColor: "#E5E7EB",
		marginBottom: 8,
	},
	reasonRowSelected: {
		borderColor: "#DC2626",
		backgroundColor: "#FEF2F2",
	},
	reasonLabel: {
		fontSize: 15,
		color: "#111827",
	},
	reasonLabelSelected: {
		color: "#DC2626",
		fontWeight: "600",
	},
	detailsLabel: {
		marginTop: 8,
		marginBottom: 6,
		fontSize: 13,
		fontWeight: "600",
		color: "#374151",
	},
	detailsInput: {
		minHeight: 80,
		borderWidth: 1,
		borderColor: "#E5E7EB",
		borderRadius: 12,
		padding: 12,
		fontSize: 14,
		color: "#111827",
		textAlignVertical: "top",
	},
	error: {
		marginBottom: 10,
		fontSize: 13,
		color: "#DC2626",
	},
	accepted: {
		alignItems: "center",
		paddingVertical: 12,
		gap: 10,
	},
	acceptedTitle: {
		fontSize: 17,
		fontWeight: "700",
		color: "#111827",
	},
	acceptedDescription: {
		fontSize: 13,
		lineHeight: 19,
		color: "#6B7280",
		textAlign: "center",
	},
	acceptedButton: {
		marginTop: 8,
		alignSelf: "stretch",
	},
});

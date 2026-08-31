import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";

// #940 【設計】リポジトリに ErrorBoundary が0件だったため、render中の未捕捉例外
// (DishMediaContent.tsx/ActionButtons.tsx の「entry is undefined」throw 等)が
// そのまま web では白画面になっていた。React の ErrorBoundary は class component でしか
// 実装できない(componentDidCatch/getDerivedStateFromError はクラスAPI専用)ため、
// ログ送信に必要な useLogger() は外側の関数コンポーネントで呼び出し props 経由で渡す。

interface ErrorBoundaryClassProps {
	children: React.ReactNode;
	/** 再試行ボタン押下時に呼ばれる。渡さない場合はエラー状態のリセットのみ行う */
	onRetry?: () => void;
	logFrontendEvent: ReturnType<typeof useLogger>["logFrontendEvent"];
	/**
	 * #1561 テーマ済みのスタイル。**class component ではフックを呼べない**ので、
	 * `logFrontendEvent` と同じく外側の関数コンポーネントで解決して渡す。
	 */
	styles: ReturnType<typeof createStyles>;
}

interface ErrorBoundaryClassState {
	error: Error | null;
}

class ErrorBoundaryClass extends React.Component<ErrorBoundaryClassProps, ErrorBoundaryClassState> {
	constructor(props: ErrorBoundaryClassProps) {
		super(props);
		this.state = { error: null };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryClassState {
		return { error };
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		this.props.logFrontendEvent({
			event_name: "error_boundary_caught",
			error_level: "error",
			payload: {
				error: error.message,
				componentStack: errorInfo.componentStack ?? undefined,
			},
		});
	}

	handleRetry = () => {
		this.props.onRetry?.();
		this.setState({ error: null });
	};

	render() {
		if (this.state.error) {
			return (
				<View style={this.props.styles.container} testID="error-boundary-fallback">
					<View style={this.props.styles.card}>
						<Text style={this.props.styles.text}>{i18n.t("Common.errors.unexpected")}</Text>
						<PrimaryButton style={this.props.styles.button} label={i18n.t("Common.retry")} onPress={this.handleRetry} />
					</View>
				</View>
			);
		}
		return this.props.children;
	}
}

interface ErrorBoundaryProps {
	children: React.ReactNode;
	/** 再試行ボタン押下時に呼ばれる(データの再取得等)。渡さない場合はエラー状態のリセットのみ行う */
	onRetry?: () => void;
}

export function ErrorBoundary({ children, onRetry }: ErrorBoundaryProps) {
	const { logFrontendEvent } = useLogger();
	const styles = useThemedStyles(createStyles);
	return (
		<ErrorBoundaryClass onRetry={onRetry} logFrontendEvent={logFrontendEvent} styles={styles}>
			{children}
		</ErrorBoundaryClass>
	);
}

/*
#1561 **クラッシュの受け皿こそテーマに追従させる。**

以前は白い背景と灰色の文字を直書きしていた。ダークモードで何かが落ちると、
暗い画面から**真っ白なカード**へ切り替わり、体感の悪さが二重になる（実機の撮影で指摘）。
`scripts/assert-no-hardcoded-colors.mjs` の除外リストからもこのファイルを外した。
*/
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
			padding: 16,
			backgroundColor: c.background,
		},
		card: {
			backgroundColor: c.surface,
			borderRadius: 20,
			padding: 32,
			alignItems: "center",
			justifyContent: "center",
			// 影の色は明暗で変えない（FixedColors 側の固定値）
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.08,
			shadowRadius: 16,
			elevation: 4,
		},
		text: {
			fontSize: 16,
			color: c.textSecondary,
			textAlign: "center",
		},
		button: {
			marginTop: 16,
		},
	});

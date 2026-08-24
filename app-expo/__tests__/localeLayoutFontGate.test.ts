import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

/**
 * #1092 不変条件テスト: `app/[locale]/_layout.tsx` はフォントの読み込み完了を待って描画を止めない。
 *
 * かつてここには `if (!fontsLoaded) return null;` があり、**UI が 1 つも描画されない**まま
 * ja では 5.5MB の `NotoSansJP-Regular.ttf` を待っていた。実際にそのフォントを使うのは
 * react-native-paper の MD3 テーマ経由の `contexts/DialogProvider.tsx` と
 * `contexts/SnackbarProvider.tsx` の 2 つだけ（= 起動直後には出ない）なので、待つ意味が無い。
 *
 * 速さは測らない（エミュレータの絶対値は実機を代表せず、閾値ベースの E2E はフレークする）。
 * 代わりに「ゲートが復活したら必ず落ちる」形にしてある。時間を測らないので感度が明確でフレークしない。
 *
 * `app/` 配下に置いたテストは expo-router がルートとして拾ってしまうため、ここに置いている。
 */

const LAYOUT_RELATIVE_PATH = path.join("app", "[locale]", "_layout.tsx");
const LAYOUT_PATH = path.join(__dirname, "..", LAYOUT_RELATIVE_PATH);
const FONT_HOOK_NAME = "useLocaleFonts";
/**
 * 検査対象は「実際にツリーを描画するコンポーネント」。
 *
 * #1509 でテーマ（ダークモード）の解決を入れるにあたり、`ThemeProvider` の中でしか
 * `useAppTheme()` を呼べないため `RootLayout` は Provider を張るだけの薄い殻になり、
 * 中身は `LocaleLayout` へ切り出された。`useLocaleFonts` とフォントゲートが居るのは
 * こちら側なので、検査対象も合わせて移してある（#1092 の不変条件そのものは変えていない）。
 */
const COMPONENT_NAME = "LocaleLayout";

const source = ts.createSourceFile(
	LAYOUT_PATH,
	fs.readFileSync(LAYOUT_PATH, "utf8"),
	ts.ScriptTarget.Latest,
	/* setParentNodes */ true,
	ts.ScriptKind.TSX,
);

/** `RootLayout` 本体（default export されたコンポーネント）を取り出す */
const findComponent = (): ts.FunctionDeclaration => {
	let found: ts.FunctionDeclaration | undefined;
	source.forEachChild((node) => {
		if (ts.isFunctionDeclaration(node) && node.name?.text === COMPONENT_NAME) found = node;
	});
	if (!found?.body) {
		throw new Error(`${LAYOUT_RELATIVE_PATH} に function ${COMPONENT_NAME} が見つからない（テストの前提が壊れている）`);
	}
	return found;
};

const component = findComponent();

/** ネストした関数（コールバック等）の中は別スコープなので辿らない */
const isNestedScope = (node: ts.Node): boolean =>
	ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);

/** `useLocaleFonts(...)` 呼び出しか */
const isFontHookCall = (node: ts.Node): node is ts.CallExpression =>
	ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === FONT_HOOK_NAME;

/**
 * `useLocaleFonts()` の戻り値を受けている識別子名。
 * `const fontsLoaded = useLocaleFonts(locale)` でも `const [fontsLoaded] = ...` でも拾う。
 */
const collectFontStateNames = (): Set<string> => {
	const names = new Set<string>();
	const visit = (node: ts.Node) => {
		if (ts.isVariableDeclaration(node) && node.initializer && isFontHookCall(node.initializer)) {
			const collectFromBinding = (name: ts.BindingName) => {
				if (ts.isIdentifier(name)) {
					names.add(name.text);
					return;
				}
				name.elements.forEach((element) => {
					if (ts.isBindingElement(element)) collectFromBinding(element.name);
				});
			};
			collectFromBinding(node.name);
		}
		node.forEachChild(visit);
	};
	visit(component);
	return names;
};

const fontStateNames = collectFontStateNames();

/** 式がフォント読み込み状態（束縛された変数、または直接の `useLocaleFonts()` 呼び出し）を参照しているか */
const referencesFontState = (node: ts.Node): boolean => {
	if (isFontHookCall(node)) return true;
	if (ts.isIdentifier(node) && fontStateNames.has(node.text)) return true;
	return node.getChildren(source).some(referencesFontState);
};

/** `(<>...</>)` のような括弧を剥がす（JSX は括弧で包む書き方が普通なので必須） */
const unwrap = (node: ts.Node): ts.Node => (ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node);

/** 「何も描画しない」を意味する式か（`null` / `undefined` / `false`） */
const rendersNothing = (input: ts.Node | undefined): boolean => {
	if (!input) return true; // `return;`
	const node = unwrap(input);
	if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return true;
	return ts.isIdentifier(node) && node.text === "undefined";
};

/** JSX を描画する式か */
const rendersJsx = (input: ts.Node): boolean => {
	const node = unwrap(input);
	return ts.isJsxElement(node) || ts.isJsxFragment(node) || ts.isJsxSelfClosingElement(node);
};

const printExpr = (node: ts.Node): string => node.getText(source).replace(/\s+/g, " ").slice(0, 120);

type Violation = { line: number; reason: string; code: string };

/**
 * `RootLayout` 本体を辿り、フォント読み込み状態が描画の有無を左右している箇所を集める。
 * `guards` は「その位置に到達するかどうかを決めている条件式」のスタック。
 */
const collectViolations = (): Violation[] => {
	const violations: Violation[] = [];
	const report = (node: ts.Node, reason: string) => {
		violations.push({
			line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
			reason,
			code: printExpr(node),
		});
	};

	const visit = (node: ts.Node, guards: ts.Expression[]) => {
		if (node !== component && isNestedScope(node)) return;

		if (ts.isIfStatement(node)) {
			visit(node.expression, guards);
			const inner = [...guards, node.expression];
			visit(node.thenStatement, inner);
			if (node.elseStatement) visit(node.elseStatement, inner);
			return;
		}

		if (ts.isConditionalExpression(node)) {
			if (referencesFontState(node.condition) && (rendersNothing(node.whenTrue) || rendersNothing(node.whenFalse))) {
				report(node, "フォント読み込み状態を条件に、片方の分岐で何も描画していない（三項演算子によるゲート）");
			}
			visit(node.condition, guards);
			const inner = [...guards, node.condition];
			visit(node.whenTrue, inner);
			visit(node.whenFalse, inner);
			return;
		}

		if (
			ts.isBinaryExpression(node) &&
			(node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
				node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
		) {
			if (referencesFontState(node.left) && rendersJsx(node.right)) {
				report(node, "フォント読み込み状態で JSX の描画可否を切り替えている（短絡評価によるゲート）");
			}
			visit(node.left, guards);
			visit(node.right, [...guards, node.left]);
			return;
		}

		if (ts.isReturnStatement(node)) {
			const gate = guards.find(referencesFontState);
			if (gate) {
				report(node, `フォント読み込み状態 \`${printExpr(gate)}\` を条件に早期 return している`);
			}
		}

		node.forEachChild((child) => visit(child, guards));
	};

	visit(component, []);
	return violations;
};

describe("#1092 app/[locale]/_layout.tsx のフォントゲート除去", () => {
	it("フォントの読み込み自体は続けている（useLocaleFonts の呼び出しを消してはいない）", () => {
		let called = false;
		const visit = (node: ts.Node) => {
			if (isFontHookCall(node)) called = true;
			node.forEachChild(visit);
		};
		visit(component);

		expect(called).toBe(true);
	});

	it("フォントの読み込み完了を理由に描画を止めない", () => {
		const violations = collectViolations();
		const detail = violations
			.map((v) => `  - ${LAYOUT_RELATIVE_PATH}:${v.line} ${v.reason}\n    > ${v.code}`)
			.join("\n");

		expect(
			violations.length === 0
				? "ゲート無し"
				: [
						"フォントの読み込み完了で描画をブロックするコードが復活している:",
						detail,
						"",
						"フォントを使うのは react-native-paper の MD3 テーマ経由の DialogProvider / SnackbarProvider だけで、",
						"起動直後の画面は元から OS 既定フォントで描画される。描画をブロックする理由が無い（#1092）。",
					].join("\n"),
		).toBe("ゲート無し");
	});
});

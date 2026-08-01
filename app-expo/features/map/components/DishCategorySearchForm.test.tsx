// #1130 【設計】BlurModal の中身が SafeArea へ食い込む件の不変条件テスト。
//
// 背景（Issue #1130）:
// レビュー投稿時の料理カテゴリ検索モーダル（BlurModal + DishCategorySearchForm）は、中身が
// `marginHorizontal` だけの素の View だった。BlurModal は中身へ safe area inset を足さないため、
// 上端は既定の `paddingVertical`（32）ぶんしか下がらず、Android のステータスバー領域へ重なっていた。
//
// Issue が見本に挙げた「保存料理カテゴリの地点検索」（features/profile/components/LocationSearchForm.tsx）は
// Card（margin 16 + paddingVertical 20）に包まれているため、中身の上端が 32 + 16 + 20 = 68px まで下がり、
// 結果として SafeArea を避けている。ここではその構造の一致を固定する。
//
// エミュレータが無いので inset の実際の見え方は測れない。代わりに
//   1. 両フォームの最外殻が同じ Card であること
//   2. Card が中身へ与えるオフセット（外側の margin と内側の paddingVertical）が両者で一致すること
// を赤で守る。
import React, { act } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key, locale: "ja-JP" } }));
jest.mock("@/components/DishCategoryAutocomplete", () => ({ DishCategoryAutocomplete: () => null }));
jest.mock("@/components/LocationAutocomplete", () => ({ LocationAutocomplete: () => null }));

import { Card } from "@/components/Card";
import { DishCategorySearchForm } from "./DishCategorySearchForm";
import { LocationSearchForm } from "@/features/profile/components/LocationSearchForm";

// React 19 では初期描画がスケジューラのタスクへ回されるため、act() で包む必要がある
// （包まないと描画が「テスト終了後」に走り、モジュールが破棄済みで落ちる）。ReviewForm.test.tsx と同じ理由。
const render = (element: React.ReactElement): TestRenderer.ReactTestRenderer => {
	let renderer!: TestRenderer.ReactTestRenderer;
	act(() => {
		renderer = TestRenderer.create(element);
	});
	return renderer;
};

/** style（配列 / 入れ子）を素朴に 1 枚のオブジェクトへ潰す */
const flattenStyle = (style: unknown): Record<string, unknown> => {
	if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
	if (style && typeof style === "object") return style as Record<string, unknown>;
	return {};
};

/**
 * Card が中身へ与えるオフセット。
 * Card は「外側 View（margin と影）＋ 内側 surface View（padding）」の 2 枚構成なので、
 * host 要素を上から 2 つ取れば外側・内側になる。
 */
const cardOffsetOf = (root: ReactTestInstance): { margin: unknown; paddingVertical: unknown } => {
	const hosts = root.findByType(Card).findAll((node) => typeof node.type === "string");
	return {
		margin: flattenStyle(hosts[0].props.style).margin,
		paddingVertical: flattenStyle(hosts[1].props.style).paddingVertical,
	};
};

describe("#1130 料理カテゴリ検索モーダルの中身が SafeArea を避ける", () => {
	it("最外殻が Card になっている（旧実装の素の View だと落ちる）", () => {
		const renderer = render(<DishCategorySearchForm onSuggestionSelect={jest.fn()} />);

		expect(renderer.root.findAllByType(Card)).toHaveLength(1);
	});

	it("見本（保存料理カテゴリの地点検索）と同じくタイトルを持つ", () => {
		const renderer = render(<DishCategorySearchForm onSuggestionSelect={jest.fn()} />);

		// i18n はキーをそのまま返すモックなので、タイトルに使うキーを直接確認できる
		const titles = renderer.root.findAll(
			(node) => typeof node.type === "string" && node.props?.children === "Map.actions.selectDishCategory",
		);
		expect(titles).not.toHaveLength(0);
	});

	it("Card が与えるオフセットが見本と一致する", () => {
		const target = render(<DishCategorySearchForm onSuggestionSelect={jest.fn()} />);
		const reference = render(<LocationSearchForm onSubmit={jest.fn()} onCancel={jest.fn()} />);

		const targetOffset = cardOffsetOf(target.root);

		expect(targetOffset).toEqual(cardOffsetOf(reference.root));
		// 見本の実測値。Card 側の既定値が変わったらここも一緒に見直すこと
		expect(targetOffset).toEqual({ margin: 16, paddingVertical: 20 });
	});
});

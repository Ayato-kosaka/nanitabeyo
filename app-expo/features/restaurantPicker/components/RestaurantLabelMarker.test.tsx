/*
#1375（オーナー指示 8 巡目）「お店を探す」画面のピン。

**このテストが守るのは 3 つ。**

1. **店名がピンに載ること。** この画面の目的は «探している店を見つける» ことなので、
   写真だけの丸では押すまでどの店か分からない
2. **`tracksViewChanges` が止まること。** 付け忘れると、地図を動かすあいだ中
   マーカーを毎フレーム焼き直し、重くなるうえネイティブヒープを食い潰して落ちる
   （#1375 で my-dishes のマップが実際に落ちた）

3. **器が固定の高さを持つこと**（#1629）。Android は Marker の children を
   «焼いた時点の測定サイズ» でビットマップ化するので、焼いたあとに中身が伸びると
   はみ出した分が描かれない（«右・下が扇形に欠ける»）。このマーカーは幅だけ固定で
   高さを中身（店名が 1 行か 2 行か）に任せていた

⚠️ 2 が落ちたら «マップが重い / 落ちる» が別画面で再発している。
⚠️ 3 が落ちたら «ピンが欠ける / 位置がずれる» が再発している。
*/
import React from "react";
import { act, create } from "react-test-renderer";
import { MARKER_TRACKING_SETTLE_MS } from "@/features/mapMarkers/hooks/useMarkerViewTracking";
import { LABEL_MARKER_HEIGHT, RestaurantLabelMarker } from "./RestaurantLabelMarker";

const markerProps: Record<string, unknown>[] = [];
jest.mock("@/components/MapView", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		Marker: (props: Record<string, unknown>) => {
			markerProps.push(props);
			return ReactActual.createElement(RNView, null, props.children as React.ReactNode);
		},
	};
});

let lastOnLoadEnd: (() => void) | undefined;
jest.mock("expo-image", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		Image: (props: { onLoadEnd?: () => void }) => {
			lastOnLoadEnd = props.onLoadEnd;
			return ReactActual.createElement(RNView, null);
		},
	};
});

const latestTracks = () => markerProps[markerProps.length - 1]?.tracksViewChanges;
/** ツリーに出ている文字列をすべて拾う（`Text` の型名に依存しない） */
const textsOf = (tree: ReturnType<typeof create>): string[] =>
	tree.root
		.findAll(() => true)
		.flatMap((n) => (Array.isArray(n.props?.children) ? n.props.children : [n.props?.children]))
		.filter((c): c is string => typeof c === "string");

const coordinate = { latitude: 35.68, longitude: 139.76 };

beforeEach(() => {
	jest.useFakeTimers();
	markerProps.length = 0;
	lastOnLoadEnd = undefined;
});
afterEach(() => {
	jest.useRealTimers();
});

it("店名をピンに出す（押すまで «どの店か» が分からない状態にしない）", () => {
	let tree!: ReturnType<typeof create>;
	act(() => {
		tree = create(<RestaurantLabelMarker coordinate={coordinate} name="醤油ラーメン一番" />);
	});
	expect(textsOf(tree)).toContain("醤油ラーメン一番");
});

it("長い店名でも 2 行までに畳む（Android の描画面の制約に収める）", () => {
	let tree!: ReturnType<typeof create>;
	act(() => {
		tree = create(<RestaurantLabelMarker coordinate={coordinate} name={"あ".repeat(60)} />);
	});
	const label = tree.root.findAll((n) => typeof n.props?.numberOfLines === "number")[0];
	expect(label.props.numberOfLines).toBe(2);
});

it("写真があるときは読み込み完了後に焼き直しを止める", () => {
	act(() => {
		create(<RestaurantLabelMarker coordinate={coordinate} name="店" uri="https://example.com/a.jpg" />);
	});
	expect(latestTracks()).toBe(true);
	act(() => {
		lastOnLoadEnd?.();
		jest.advanceTimersByTime(MARKER_TRACKING_SETTLE_MS);
	});
	expect(latestTracks()).toBe(false);
});

it("写真が無いピンも焼き直しを止める（読み込み完了が来ないため）", () => {
	let tree!: ReturnType<typeof create>;
	act(() => {
		tree = create(<RestaurantLabelMarker coordinate={coordinate} name="店" />);
	});
	act(() => {
		tree.root.findAll((n) => typeof n.props?.onLayout === "function")[0]?.props.onLayout();
		jest.advanceTimersByTime(MARKER_TRACKING_SETTLE_MS);
	});
	expect(latestTracks()).toBe(false);
});

it("選択状態が変わったら焼き直しを再開する（色が変わる＝絵が変わる）", () => {
	let tree!: ReturnType<typeof create>;
	act(() => {
		tree = create(<RestaurantLabelMarker coordinate={coordinate} name="店" uri="https://example.com/a.jpg" />);
	});
	act(() => {
		lastOnLoadEnd?.();
		jest.advanceTimersByTime(MARKER_TRACKING_SETTLE_MS);
	});
	expect(latestTracks()).toBe(false);
	act(() => {
		tree.update(<RestaurantLabelMarker coordinate={coordinate} name="店" uri="https://example.com/a.jpg" isActive />);
	});
	expect(latestTracks()).toBe(true);
});

/*
#1629 オーナー実機報告「お店を選ぶのマップピンが Android で映らない」への対応。

**店名が 1 行でも 2 行でも器の高さが変わらないこと**を固定する。変わると、
Android では焼いたビットマップからはみ出した分が描かれず、`anchor`（割合指定）の
実ピクセル位置もピンごとにずれる。

⚠️ これは «実機で再現して直したもの» ではない。エミュレータを label の倍率へ入れる
   手段が 3 回とも外部要因（Places のクォータ / 測位）で潰れ、まだ実機で撮れていない。
   ここで固定しているのは «高さが中身に依存しない» というコード上の性質だけである。
*/
const heightOfContainer = (tree: ReturnType<typeof create>): number | undefined => {
	// 器は «幅を持つ View» で、その style に高さが入っていること
	const node = tree.root.findAll((n) => {
		const style = n.props?.style;
		return typeof n.type === "string" && !!style && !Array.isArray(style) && style.width !== undefined;
	})[0];
	return node?.props?.style?.height;
};

it("器は固定の高さを持つ（焼いたあとに伸びて欠けないようにする）", () => {
	let tree!: ReturnType<typeof create>;
	act(() => {
		tree = create(<RestaurantLabelMarker coordinate={coordinate} name="店" />);
	});
	expect(heightOfContainer(tree)).toBe(LABEL_MARKER_HEIGHT);
});

it("店名が 1 行でも 2 行でも器の高さは変わらない", () => {
	let short!: ReturnType<typeof create>;
	let long!: ReturnType<typeof create>;
	act(() => {
		short = create(<RestaurantLabelMarker coordinate={coordinate} name="鮨" />);
	});
	act(() => {
		long = create(<RestaurantLabelMarker coordinate={coordinate} name={"あ".repeat(60)} />);
	});
	/*
	⚠️ `toBe(heightOfContainer(long))` だけにしないこと。高さが **両方とも undefined**
	   （= 固定していない）のときも通ってしまい、**落ちないテスト**になる（実測で確認した）。
	   具体的な値と突き合わせる。
	*/
	expect(heightOfContainer(short)).toBe(LABEL_MARKER_HEIGHT);
	expect(heightOfContainer(long)).toBe(LABEL_MARKER_HEIGHT);
});

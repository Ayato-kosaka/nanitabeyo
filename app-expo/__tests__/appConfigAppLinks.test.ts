/*
#1660 【設計】App Links（`autoVerify: true`）の https ホストを «自分で assetlinks.json を置けるドメイン» に固定する。

## なぜ必要か
`autoVerify` の intent filter に載せた https ホストは、Google が
`https://<host>/.well-known/assetlinks.json` を取りに行って検証する。他社のドメインを足すと
そこへファイルを置けないため **検証が永久に失敗し**、Play Console の Deep links が
「Domain ownership not verified」を出し続ける（実際に `*.supabase.co` で起きた）。
Android 11 以下は検証がアプリ単位なので、1 つ落ちると app.nanitabeyo.net まで巻き添えになる。

## 何を守るか
1. autoVerify の filter の https ホストが `app.nanitabeyo.net` だけであること
2. assetlinks.json を配信している `app-expo/public/.well-known/` の実体が存在すること
   （intent filter だけ足しても、配信物が無ければ検証は通らない）
*/
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { ExpoConfig } from "@expo/config";

const loadConfig = (): ExpoConfig => require("../app.config").default({ config: {} });

const ASSETLINKS_PATH = join(__dirname, "../public/.well-known/assetlinks.json");

describe("#1660 App Links の対象ドメイン", () => {
	const autoVerifyFilters = () =>
		(loadConfig().android?.intentFilters ?? []).filter((filter) => filter.autoVerify);

	it("autoVerify の https ホストは app.nanitabeyo.net だけ", () => {
		const httpsHosts = autoVerifyFilters().flatMap((filter) =>
			(Array.isArray(filter.data) ? filter.data : filter.data ? [filter.data] : [])
				.filter((entry) => entry.scheme === "https" || entry.scheme === "http")
				.map((entry) => entry.host),
		);
		expect(httpsHosts).toEqual(["app.nanitabeyo.net"]);
	});

	it("autoVerify のホストにワイルドカードを使わない", () => {
		const hosts = autoVerifyFilters().flatMap((filter) =>
			(Array.isArray(filter.data) ? filter.data : filter.data ? [filter.data] : []).map((entry) => entry.host),
		);
		expect(hosts.filter((host) => host?.includes("*"))).toEqual([]);
	});

	it("assetlinks.json が対象ドメイン向けに配信されている", () => {
		expect(existsSync(ASSETLINKS_PATH)).toBe(true);
		const statements = JSON.parse(readFileSync(ASSETLINKS_PATH, "utf8"));
		expect(statements.map((statement: any) => statement.target.package_name)).toContain("com.nanitabeyo");
	});
});

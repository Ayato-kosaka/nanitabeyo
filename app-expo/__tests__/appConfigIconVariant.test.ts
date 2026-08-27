/*
#1552 【設計】ビルドプロファイルごとのアイコン差し替えの «既定値» を固定する。

## なぜ必要か
app.config.ts は APP_VARIANT / EAS_BUILD_PROFILE でアイコンを DEV / PREV ラベル入りへ
差し替える。この分岐で一番大きい事故は **本番ビルドへラベル付きアイコンが出ること**
なので、「env が無い・未知の値」がすべて production 用アセットへ倒れることをテストで守る。

## 何を守るか
1. env 未設定・production・未知の値 → 既存の icon.png / adaptive-icon.png のまま
2. development → icon-dev.png / adaptive-icon-dev.png
3. preview → icon-prev.png / adaptive-icon-prev.png
4. APP_VARIANT が EAS_BUILD_PROFILE より優先される（ローカル prebuild での明示上書き用）
5. 参照する 6 アセットが実在する（パスの typo で EAS ビルドだけが落ちるのを防ぐ）
*/
import { existsSync } from "fs";
import { join } from "path";
import type { ExpoConfig } from "@expo/config";

const loadConfig = (env: Record<string, string | undefined>): ExpoConfig => {
	const saved = { APP_VARIANT: process.env.APP_VARIANT, EAS_BUILD_PROFILE: process.env.EAS_BUILD_PROFILE };
	delete process.env.APP_VARIANT;
	delete process.env.EAS_BUILD_PROFILE;
	Object.assign(process.env, env);
	try {
		jest.resetModules();
		// app.config.ts は module 評価時に env を読むため、env を差し替えるたびに require し直す
		const configFn = require("../app.config").default;
		return configFn({ config: {} });
	} finally {
		delete process.env.APP_VARIANT;
		delete process.env.EAS_BUILD_PROFILE;
		Object.assign(process.env, saved);
	}
};

const icons = (config: ExpoConfig) => ({
	icon: config.icon,
	foregroundImage: config.android?.adaptiveIcon?.foregroundImage,
});

describe("#1552 ビルドプロファイル別アイコン", () => {
	const production = {
		icon: "./assets/images/icon.png",
		foregroundImage: "./assets/images/adaptive-icon.png",
	};

	it.each([
		["env 未設定", {}],
		["production", { EAS_BUILD_PROFILE: "production" }],
		["未知のプロファイル", { EAS_BUILD_PROFILE: "staging" }],
		["APP_VARIANT が未知", { APP_VARIANT: "dev" }],
	])("%s → production 用アセット（ラベル無し）", (_label, env) => {
		expect(icons(loadConfig(env))).toEqual(production);
	});

	it("development → DEV ラベル入りアセット", () => {
		expect(icons(loadConfig({ EAS_BUILD_PROFILE: "development" }))).toEqual({
			icon: "./assets/images/icon-dev.png",
			foregroundImage: "./assets/images/adaptive-icon-dev.png",
		});
	});

	it("preview → PREV ラベル入りアセット", () => {
		expect(icons(loadConfig({ EAS_BUILD_PROFILE: "preview" }))).toEqual({
			icon: "./assets/images/icon-prev.png",
			foregroundImage: "./assets/images/adaptive-icon-prev.png",
		});
	});

	it("APP_VARIANT は EAS_BUILD_PROFILE より優先される", () => {
		expect(icons(loadConfig({ APP_VARIANT: "preview", EAS_BUILD_PROFILE: "development" }))).toEqual({
			icon: "./assets/images/icon-prev.png",
			foregroundImage: "./assets/images/adaptive-icon-prev.png",
		});
	});

	it("全バリアントのアイコンアセットが実在する", () => {
		for (const file of [
			"icon.png",
			"icon-dev.png",
			"icon-prev.png",
			"adaptive-icon.png",
			"adaptive-icon-dev.png",
			"adaptive-icon-prev.png",
		]) {
			expect(existsSync(join(__dirname, "..", "assets", "images", file))).toBe(true);
		}
	});
});

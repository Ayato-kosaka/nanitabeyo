// prisma.config.ts（プロジェクトルート直下）
// @ts-ignore
import { defineConfig, env } from "prisma/config";
// @ts-ignore
import dotenv from "dotenv";
// @ts-ignore
import path from "node:path";

// bash で source api/.env してるなら dotenv は必須ではないけど、
// 直にコマンド打つケースも考えるならこれを付けておくと安全：
// import 'dotenv/config'
dotenv.config({ path: "api/.env" }); // ここで generate 時にも api/.env を読み込ませる

export default defineConfig({
	engine: "classic",
	schema: path.join("api", "prisma", "schema.prisma"),

	// Prisma 7 では datasource の URL はここに書く
	datasource: {
		url: env("DATABASE_URL"),
	},
});

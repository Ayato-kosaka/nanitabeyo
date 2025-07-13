import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { Parser as Json2CsvParser } from "json2csv";
import "dotenv/config";

// スプレッドシートの列情報の型
export type TColumn = {
	t_name: string;
	c_name: string;
	c_datatype: string;
	c_primary: boolean;
	c_foreign_key?: string;
	c_unique?: boolean;
	c_not_null?: boolean;
	c_default?: string;
	c_index?: boolean;
	c_comment?: string;
};

/**
 * GAS WebAPI から T_COLUMNS 情報を取得する
 * @returns スプレッドシート由来のカラム定義配列
 * @throws fetchやパースで失敗した場合に例外
 */
export async function fetchTColumnsFromApi(): Promise<TColumn[]> {
	try {
		const apiUrl = process.env.SHARED_PG_DATA_GAS_API_URL;
		if (!apiUrl) {
			throw new Error("Environment variable SHARED_PG_DATA_GAS_API_URL is not defined.");
		}

		const res = await fetch(apiUrl);
		if (!res.ok) {
			throw new Error(`Failed to fetch from GAS: ${res.status} ${res.statusText}`);
		}

		const json: { T_COLUMNS: TColumn[] } = await res.json();

		if (!json.T_COLUMNS || !Array.isArray(json.T_COLUMNS)) {
			throw new Error("Invalid response format: Missing or malformed T_COLUMNS");
		}

		Object.keys(json).forEach((key) => {
			// @ts-ignore
			json[key] = json[key].filter((row) => Object.values(row).some((value) => !!value));
		});

		// === 出力処理 ===
		const outputDir = path.resolve(__dirname, "../../docs/detailed_design");
		fs.rmSync(outputDir, { recursive: true, force: true });
		fs.mkdirSync(outputDir, { recursive: true });
		await Object.keys(json).forEach(async (key) => {
			// @ts-ignore
			const obj: Record<string, unknown>[] = json[key];
			const keys = Object.keys(obj[0]);
			const parser = new Json2CsvParser({ fields: keys, defaultValue: "" });
			const csv = parser.parse(obj);
			const outputPath = path.resolve(outputDir, `${key}.csv`);
			fs.writeFileSync(outputPath, csv, { encoding: "utf-8" });
		});

		return json.T_COLUMNS;
	} catch (error) {
		console.error("🔥 Error fetching T_COLUMNS from GAS:", error);
		throw error;
	}
}

import fs from "fs";
import path from "path";
import { fetchTColumnsFromApi, TColumn } from "./fetchFromGAS";

/**
 * 日付型に分類される PostgreSQL データ型の一覧
 */
const DATE_TYPES = [
	"date",
	"timestamp",
	"timestamp without time zone",
	"timestamp with time zone",
	"timestamptz",
	"time",
	"time without time zone",
	"time with time zone",
	"timetz",
	"interval",
];

/**
 * 数値型（高精度）のデータ型一覧
 */
const DECIMAL_TYPES = ["numeric", "decimal", "numeric(", "decimal("];

/**
 * 文字列の先頭を大文字に変換
 * @param str 入力文字列
 * @returns 先頭大文字に変換した文字列
 */
function capitalizeFirstLetter(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * スネークケース文字列を PascalCase に変換
 * @param str 入力文字列（スネークケース）
 * @returns PascalCase 形式の文字列
 */
function toPascalCase(str: string): string {
	return str.replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase());
}

/**
 * 指定の型が除外対象であるかを判定
 * @param columnType カラムのデータ型文字列
 * @returns 除外対象であれば true
 */
function isExccludedType(columnType: string): boolean {
	return ["tsvector", "geography(point,4326)"].includes(columnType.toLowerCase());
}

/**
 * 指定の型が日付型であるかを判定
 * @param columnType カラムのデータ型文字列
 * @returns 日付型であれば true
 */
function isDateColumn(columnType: string): boolean {
	return DATE_TYPES.some((type) => columnType.toLowerCase().startsWith(type));
}

/**
 * 指定の型が数値型（Decimal）であるかを判定
 * @param columnType カラムのデータ型文字列
 * @returns Decimal 型であれば true
 */
function isDecimalColumn(columnType: string): boolean {
	return DECIMAL_TYPES.some((type) => columnType.toLowerCase().startsWith(type));
}

/**
 * 指定の型が BigInt 型であるかを判定
 * @param columnType カラムのデータ型文字列
 * @returns BigInt 型であれば true
 */
function isBigIntColumn(columnType: string): boolean {
	return columnType.toLowerCase() === "bigint";
}

/**
 * 配列型かどうかを判定（e.g. text[]）
 * @param columnType カラムのデータ型
 * @returns 配列型であれば true
 */
function isArrayColumn(columnType: string): boolean {
	return /\[\s*\]$/.test(columnType.trim());
}

/**
 * 配列型からベースのデータ型を抽出（e.g. text[] → text）
 * @param columnType カラムのデータ型
 * @returns ベース型名（小文字）
 */
function getBaseType(columnType: string): string {
	return columnType
		.replace(/\[\s*\]$/, "")
		.trim()
		.toLowerCase();
}

/**
 * 特定のテーブル定義に基づく Supabase/Prisma 相互変換関数の TypeScript コードを生成
 * @param tableName 対象のテーブル名
 * @param columns 対象テーブルのカラム一覧
 * @returns TypeScript の変換関数コード文字列
 */
function generateConverter(tableName: string, columns: TColumn[]): string {
	const tablePascal = toPascalCase(tableName);
	const prismaTypeName = `${capitalizeFirstLetter(tableName)}GroupByOutputType`;

	// Supabase → Prisma 変換本体
	const toPrismaBody = columns
		.map(({ c_name, c_datatype, c_not_null }) => {
			if (isExccludedType(c_datatype)) return;
			const isArray = isArrayColumn(c_datatype);
			const baseType = getBaseType(c_datatype);

			if (isArray) {
				if (isDateColumn(baseType))
					return c_not_null
						? `    ${c_name}: supabase.${c_name}.map((v) => new Date(v)),`
						: `    ${c_name}: supabase.${c_name} !== null ? supabase.${c_name}.map((v) => new Date(v)) : null,`;
				if (isDecimalColumn(baseType))
					return c_not_null
						? `    ${c_name}: supabase.${c_name}.map((v) => new Prisma.Decimal(v)),`
						: `    ${c_name}: supabase.${c_name} !== null ? supabase.${c_name}.map((v) => new Prisma.Decimal(v)) : null,`;
				if (isBigIntColumn(baseType))
					return c_not_null
						? `    ${c_name}: supabase.${c_name}.map((v) => BigInt(v)),`
						: `    ${c_name}: supabase.${c_name} !== null ? supabase.${c_name}.map((v) => BigInt(v)) : null,`;
				// その他の配列型はそのまま
				return `    ${c_name}: supabase.${c_name},`;
			}

			if (isDateColumn(baseType))
				return c_not_null
					? `    ${c_name}: new Date(supabase.${c_name}),`
					: `    ${c_name}: supabase.${c_name} !== null ? new Date(supabase.${c_name}) : null,`;
			if (isDecimalColumn(baseType))
				return c_not_null
					? `    ${c_name}: new Prisma.Decimal(supabase.${c_name}),`
					: `    ${c_name}: supabase.${c_name} !== null ? new Prisma.Decimal(supabase.${c_name}) : null,`;
			if (isBigIntColumn(baseType))
				return c_not_null
					? `    ${c_name}: BigInt(supabase.${c_name}),`
					: `    ${c_name}: supabase.${c_name} !== null ? BigInt(supabase.${c_name}) : null,`;
			return `    ${c_name}: supabase.${c_name},`;
		})
		.join("\n");

	// Prisma → Supabase 変換本体
	const toSupabaseBody = columns
		.map(({ c_name, c_datatype, c_not_null }) => {
			if (isExccludedType(c_datatype)) return `    ${c_name}: null,`;
			const isArray = isArrayColumn(c_datatype);
			const baseType = getBaseType(c_datatype);

			if (isArray) {
				if (isDateColumn(baseType)) return `    ${c_name}: prisma.${c_name}?.map((v) => v.toISOString()) ?? null,`;
				if (isDecimalColumn(baseType)) return `    ${c_name}: prisma.${c_name}?.map((v) => v.toNumber()) ?? null,`;
				if (isBigIntColumn(baseType)) return `    ${c_name}: prisma.${c_name}.map((v) => Number(v)) ?? null,`;
				return `    ${c_name}: prisma.${c_name},`;
			}

			if (isDateColumn(baseType)) return `    ${c_name}: prisma.${c_name}?.toISOString() ?? null,`;
			if (isDecimalColumn(baseType)) return `    ${c_name}: prisma.${c_name}?.toNumber() ?? null,`;
			if (isBigIntColumn(baseType))
				return c_not_null
					? `    ${c_name}: Number(prisma.${c_name}),`
					: `    ${c_name}: prisma.${c_name} !== null ? Number(prisma.${c_name}) : null,`;

			return `    ${c_name}: prisma.${c_name},`;
		})
		.join("\n");

	const imports = `import { TableRow } from '../utils/devDB.types';\nimport { Prisma } from '../prisma';\n\n`;

	return `${imports}
export type Prisma${tablePascal} = Omit<Prisma.${prismaTypeName}, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type Supabase${tablePascal} = TableRow<'${tableName}'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_${tablePascal}(supabase: Supabase${tablePascal}): Prisma${tablePascal} {
  return {
${toPrismaBody}
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_${tablePascal}(prisma: Prisma${tablePascal}): Supabase${tablePascal} {
  return {
${toSupabaseBody}
  };
}
`;
}

/**
 * 与えられた全カラムリストからテーブル単位で変換スクリプトを自動生成する
 * @param allColumns 全テーブルのカラム情報リスト
 */
export function generateConvertersOnly(allColumns: TColumn[]) {
	const columnsByTable = allColumns.reduce<Record<string, TColumn[]>>((acc, column) => {
		if (!acc[column.t_name]) acc[column.t_name] = [];
		acc[column.t_name].push(column);
		return acc;
	}, {});

	for (const [tableName, columnsForTable] of Object.entries(columnsByTable)) {
		try {
			const converterCode = generateConverter(tableName, columnsForTable);
			const outputDirectory = path.resolve(__dirname, `../converters`);
			fs.mkdirSync(outputDirectory, { recursive: true });

			const outputPath = path.join(outputDirectory, `convert_${tableName}.ts`);
			fs.writeFileSync(outputPath, converterCode, "utf-8");
			console.log(`✅ Generated: ${outputPath}`);
		} catch (error) {
			console.error(`❌ Failed to generate converter for table "${tableName}":`, error);
		}
	}
}

/**
 * API 経由でスプレッドシートからカラム情報を取得し、変換コードを自動生成
 */
(async () => {
	try {
		const fetchedColumns = await fetchTColumnsFromApi();
		console.log(`🧩 Columns fetched: ${fetchedColumns.length}`);
		generateConvertersOnly(fetchedColumns);
	} catch (error) {
		console.error("❌ Failed to fetch column definitions from API:", error);
	}
})();

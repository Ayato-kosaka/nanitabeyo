// app-expo/lib/googlePlaces.ts
//
// Google Places 関連のユーティリティ関数
// 住所コンポーネントから通貨コードを決定する処理を提供
//

import { SupabaseRestaurants } from "@shared/converters/convert_restaurants";
import { Linking } from "react-native";

/**
 * Google Places API の IAddressComponent 型定義
 */
export interface IAddressComponent {
	/** AddressComponent longText */
	longText?: string | null;

	/** AddressComponent shortText */
	shortText?: string | null;

	/** AddressComponent types */
	types?: string[] | null;

	/** AddressComponent languageCode */
	languageCode?: string | null;
}

/**
 * 国コードから通貨コードへのマッピング表 (ISO-3166-1 → ISO-4217)
 * 主要/全世界の国と地域を網羅。正確性重視。不明・通貨なしは null。
 * 例: getCurrencyCode("JP") => "JPY"
 *     getCurrencySymbol("JP") => "¥"
 */
export const COUNTRY_TO_CURRENCY_MAP = {
	// 既存の主要通貨（維持）
	US: "USD",
	EU: "EUR", // 例外的に予約コード（EU機関向け）。便宜上残置。
	GB: "GBP",
	CL: "CLP",
	CO: "COP",
	SE: "SEK",
	DK: "DKK",
	PL: "PLN",
	CZ: "CZK",
	HU: "HUF",
	RU: "RUB",

	// ユーロ圏（EUR）
	AT: "EUR",
	BE: "EUR",
	CY: "EUR",
	EE: "EUR",
	FI: "EUR",
	FR: "EUR",
	DE: "EUR",
	GR: "EUR",
	IE: "EUR",
	IT: "EUR",
	LV: "EUR",
	LT: "EUR",
	LU: "EUR",
	MT: "EUR",
	NL: "EUR",
	PT: "EUR",
	SK: "EUR",
	SI: "EUR",
	ES: "EUR",
	// 追加：クロアチアは2023年からEUR
	HR: "EUR",

	// 北米・中南米
	AG: "XCD",
	AI: "XCD",
	AN: null, // AN(蘭領アンティル)は廃止コード（保持しない場合は削除可）
	AW: "AWG",
	BB: "BBD",
	BL: "EUR",
	BM: "BMD",
	BQ: "USD",
	BS: "BSD",
	BZ: "BZD",
	BO: "BOB",
	BR: "BRL",
	CA: "CAD",
	CR: "CRC",
	CU: "CUP",
	CW: "ANG",
	DM: "XCD",
	DO: "DOP",
	EC: "USD",
	SV: "USD",
	GD: "XCD",
	GP: "EUR",
	GT: "GTQ",
	GY: "GYD",
	HN: "HNL",
	HT: "HTG",
	JM: "JMD",
	KN: "XCD",
	KY: "KYD",
	LC: "XCD",
	MF: "EUR",
	MQ: "EUR",
	MS: "XCD",
	MX: "MXN",
	NI: "NIO",
	PA: "PAB",
	PE: "PEN",
	PM: "EUR",
	PR: "USD",
	PY: "PYG",
	SR: "SRD",
	SX: "ANG",
	TT: "TTD",
	UY: "UYU",
	VC: "XCD",
	VE: "VES",

	// 欧州その他
	AD: "EUR",
	AL: "ALL",
	AM: "AMD",
	AX: "EUR",
	BA: "BAM",
	BG: "BGN",
	BY: "BYN",
	CH: "CHF",
	GG: "GBP",
	GI: "GIP",
	IM: "GBP",
	IS: "ISK",
	JE: "GBP",
	LI: "CHF",
	MC: "EUR",
	MD: "MDL",
	ME: "EUR",
	MK: "MKD",
	NO: "NOK",
	RO: "RON",
	RS: "RSD",
	SJ: "NOK",
	SM: "EUR",
	UA: "UAH",
	VA: "EUR",

	// アフリカ
	AO: "AOA",
	BF: "XOF",
	BI: "BIF",
	BJ: "XOF",
	BW: "BWP",
	CD: "CDF",
	CF: "XAF",
	CG: "XAF",
	CI: "XOF",
	CM: "XAF",
	CV: "CVE",
	DJ: "DJF",
	DZ: "DZD",
	EG: "EGP",
	EH: "MAD",
	ER: "ERN",
	ET: "ETB",
	GA: "XAF",
	GH: "GHS",
	GM: "GMD",
	GN: "GNF",
	GQ: "XAF",
	GW: "XOF",
	KE: "KES",
	KM: "KMF",
	LR: "LRD",
	LS: "LSL",
	LY: "LYD",
	MA: "MAD",
	MG: "MGA",
	ML: "XOF",
	MR: "MRU",
	MU: "MUR",
	MW: "MWK",
	NA: "NAD",
	NE: "XOF",
	NG: "NGN",
	RE: "EUR",
	RW: "RWF",
	SC: "SCR",
	SD: "SDG",
	SH: "SHP",
	SL: "SLE",
	SN: "XOF",
	SO: "SOS",
	SS: "SSP",
	ST: "STN",
	SZ: "SZL",
	TD: "XAF",
	TG: "XOF",
	TN: "TND",
	TZ: "TZS",
	UG: "UGX",
	YT: "EUR",
	ZA: "ZAR",
	ZM: "ZMW",
	ZW: "ZWG", // 2024年導入 ZiG (ISO: ZWG)

	// 中東
	AE: "AED",
	BH: "BHD",
	IQ: "IQD",
	IR: "IRR",
	IL: "ILS",
	JO: "JOD",
	KW: "KWD",
	LB: "LBP",
	OM: "OMR",
	PS: "ILS",
	QA: "QAR",
	SA: "SAR",
	SY: "SYP",
	TR: "TRY",
	YE: "YER",

	// アジア
	AF: "AFN",
	AZ: "AZN",
	BD: "BDT",
	BT: "BTN",
	BN: "BND",
	KH: "KHR",
	CN: "CNY",
	GE: "GEL",
	HK: "HKD",
	IN: "INR",
	ID: "IDR",
	JP: "JPY",
	KZ: "KZT",
	KG: "KGS",
	LA: "LAK",
	MO: "MOP",
	MY: "MYR",
	MV: "MVR",
	MN: "MNT",
	MM: "MMK",
	NP: "NPR",
	PK: "PKR",
	PH: "PHP",
	KR: "KRW",
	KP: "KPW",
	SG: "SGD",
	LK: "LKR",
	TW: "TWD",
	TH: "THB",
	TJ: "TJS",
	TM: "TMT",
	UZ: "UZS",
	VN: "VND",

	// 大洋州
	AS: "USD",
	AU: "AUD",
	CC: "AUD",
	CK: "NZD",
	CX: "AUD",
	FJ: "FJD",
	FM: "USD",
	KI: "AUD",
	MH: "USD",
	MP: "USD",
	NC: "XPF",
	NF: "AUD",
	NR: "AUD",
	NU: "NZD",
	NZ: "NZD",
	PG: "PGK",
	PN: "NZD",
	PW: "USD",
	SB: "SBD",
	TK: "NZD",
	TL: "USD",
	TO: "TOP",
	TV: "AUD",
	UM: "USD",
	VU: "VUV",
	WF: "XPF",
	WS: "WST",

	// 英仏などの本国・海外領土（補完）
	FO: "DKK",
	GL: "DKK",
	GF: "EUR",
	PF: "XPF",
	TF: "EUR",
	VG: "USD",
	VI: "USD",
	GU: "USD",
	// 南極は通貨なし
	AQ: null,
	// 念のため重複防止
} as const;

/** ISO-4217 通貨コードから通貨記号へのマッピング表
 * 例: CURRENCY_SYMBOL_MAP["JPY"] => "¥"
 * ※ Intl API が利用できない環境向けのフォールバックとして使用
 */
export const CURRENCY_SYMBOL_MAP = {
	USD: "$",
	EUR: "€",
	GBP: "£",
	CLP: "$",
	COP: "$",
	SEK: "kr",
	DKK: "kr",
	PLN: "zł",
	CZK: "Kč",
	HUF: "Ft",
	RUB: "₽",

	XCD: "$",
	AWG: "ƒ",
	BBD: "$",
	BMD: "$",
	BSD: "$",
	BZD: "$",
	BOB: "Bs",
	BRL: "R$",
	CAD: "$",
	CRC: "₡",
	CUP: "₱",
	ANG: "ƒ",
	DOP: "RD$",
	GTQ: "Q",
	GYD: "$",
	HNL: "L",
	HTG: "G",
	JMD: "J$",
	KYD: "$",
	MXN: "$",
	NIO: "C$",
	PAB: "B/.",
	PEN: "S/",
	PYG: "₲",
	SRD: "$",
	TTD: "TT$",
	UYU: "$U",
	VES: "Bs",

	ALL: "L",
	AMD: "֏",
	BAM: "KM",
	BGN: "лв",
	BYN: "Br",
	CHF: "CHF",
	GIP: "£",
	ISK: "kr",
	MDL: "L",
	MKD: "ден",
	NOK: "kr",
	RON: "lei",
	RSD: "дин",
	UAH: "₴",

	AOA: "Kz",
	XOF: "CFA",
	BIF: "FBu",
	BWP: "P",
	CDF: "FC",
	XAF: "FCFA",
	CVE: "$",
	DJF: "Fdj",
	DZD: "دج",
	EGP: "£",
	MAD: "MAD",
	ERN: "Nfk",
	ETB: "Br",
	GHS: "₵",
	GMD: "D",
	GNF: "FG",
	KES: "KSh",
	KMF: "CF",
	LRD: "$",
	LSL: "L",
	LYD: "ل.د",
	MGA: "Ar",
	MRU: "UM",
	MUR: "₨",
	MWK: "MK",
	NAD: "$",
	NGN: "₦",
	RWF: "FRw",
	SCR: "₨",
	SDG: "£",
	SHP: "£",
	SLE: "Le",
	SOS: "S",
	SSP: "£",
	STN: "Db",
	SZL: "E",
	TND: "د.ت",
	TZS: "TSh",
	UGX: "USh",
	ZAR: "R",
	ZMW: "ZK",
	ZWG: "ZiG",

	AED: "د.إ",
	BHD: "ب.د",
	IQD: "ع.د",
	IRR: "﷼",
	ILS: "₪",
	JOD: "د.ا",
	KWD: "د.ك",
	LBP: "ل.ل",
	OMR: "ر.ع.",
	QAR: "ر.ق",
	SAR: "ر.س",
	SYP: "£",
	TRY: "₺",
	YER: "﷼",

	AFN: "؋",
	AZN: "₼",
	BDT: "৳",
	BTN: "Nu.",
	BND: "$",
	KHR: "៛",
	CNY: "¥",
	GEL: "₾",
	HKD: "$",
	INR: "₹",
	IDR: "Rp",
	JPY: "¥",
	KZT: "₸",
	KGS: "с",
	LAK: "₭",
	MOP: "P",
	MYR: "RM",
	MVR: "ރ.",
	MNT: "₮",
	MMK: "K",
	NPR: "₨",
	PKR: "₨",
	PHP: "₱",
	KRW: "₩",
	KPW: "₩",
	SGD: "$",
	LKR: "Rs",
	TWD: "NT$",
	THB: "฿",
	TJS: "ЅМ",
	TMT: "m",
	UZS: "so‘m",
	VND: "₫",

	FJD: "$",
	NZD: "$",
	PGK: "K",
	SBD: "$",
	TOP: "T$",
	AUD: "$",
	VUV: "VT",
	WST: "WS$",
	XPF: "₣",
} as const;

/**
 * 通貨コードから通貨記号を取得（Intl API使用版）
 * @param currencyCode ISO-4217 通貨コード (例: "JPY", "USD")
 * @param locale ロケールコード (例: "ja-JP", "en-US") - 省略時は "en-US"
 * @returns 通貨記号 (例: "¥", "$") または通貨コード自体 (Intl未対応やエラー時)
 */
export function resolveCurrencySymbol(currencyCode: string | null, locale: string) {
	if (!currencyCode) return null; // 通貨コードが null/空の場合は空文字を返す
	const code = currencyCode.toUpperCase();
	const fallback = CURRENCY_SYMBOL_MAP[code as keyof typeof CURRENCY_SYMBOL_MAP] ?? code;
	try {
		if (typeof Intl !== "undefined" && typeof Intl.NumberFormat === "function") {
			const parts = new Intl.NumberFormat(locale, {
				style: "currency",
				currency: currencyCode,
				currencyDisplay: "narrowSymbol", // 記号優先。なければコード等に落ちる
				minimumFractionDigits: 0,
				maximumFractionDigits: 0,
			}).formatToParts(0);

			const sym = parts.find((p) => p.type === "currency")?.value;
			return sym || code;
		}
	} catch {
		return fallback; // Hermes/Intl未対応などの最終フォールバック
	}
	return fallback;
}

/**
 * 通貨の最小単位 (minor units) を返す（ISO-4217 準拠）。
 * 未定義の通貨は 2 桁を既定とする。
 *
 * 参考例:
 *  - USD/EUR/GBP = 2
 *  - JPY/KRW/VND/CLP/ISK/XAF/XOF/RWF/GNF = 0
 *  - KWD/BHD/OMR/JOD/TND/LYD/IQD = 3
 */
export function getMinorUnitDigits(currencyCode: string | null | undefined): number {
	const code = (currencyCode || "").toUpperCase();

	// 0 桁（小数なし）
	const ZERO = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "XAF", "XOF", "RWF", "GNF", "UGX"]);

	// 3 桁
	const THREE = new Set(["KWD", "BHD", "OMR", "JOD", "TND", "LYD", "IQD"]);

	// 4 桁（CLFなど。通常は使わない想定）
	const FOUR = new Set(["CLF"]);

	if (ZERO.has(code)) return 0;
	if (THREE.has(code)) return 3;
	if (FOUR.has(code)) return 4;

	// 既知の 2 桁通貨の例を明示（網羅は不要。未列挙は既定 2）
	// USD/EUR/GBP/AUD/CAD/CHF/CNY/HKD/INR/IDR/NZD/SGD/THB/TWD/BRL/MXN/PLN/SEK/NOK/DKK/RUB/RON/HUF ... → 2
	return 2;
}

/**
 * 文字列入力を数値にパース（ロケール簡易対応）
 * - "1,234.56" → 1234.56
 * - "1.234,56" のような欧州表記は、ドットが3桁区切り・カンマが小数と推定して 1234.56 に変換
 * - 記号や空白は除去（$、¥、€、スペースなど）
 */
export function parseAmountString(raw: string): number {
	// 通貨記号やスペース、全角記号を除去
	const cleaned = raw
		.replace(/\s+/g, "")
		.replace(/[￥¥€$£₩₫₦₱₹₽₪₭₮₲₴₺₼₸₡₵₲₥]/g, "")
		.replace(/[A-Z]{3}/gi, ""); // 末尾などの "USD" "JPY" を雑に除去

	// 小数と桁区切りの推定
	// 1) 両方（. と ,）がある場合 → 欧州系 "1.234,56" を想定して、まず桁区切りドットを除去→カンマを小数点に
	if (cleaned.includes(".") && cleaned.includes(",")) {
		const noGroupDots = cleaned.replace(/\./g, "");
		const normalized = noGroupDots.replace(/,/g, ".");
		return parseFloat(normalized);
	}

	// 2) 片方のみの場合
	//   - カンマのみ: "1234,56" → 小数点と見なして '.' に変換
	//   - ドットのみ: そのまま小数点
	if (cleaned.includes(",") && !cleaned.includes(".")) {
		return parseFloat(cleaned.replace(/,/g, "."));
	}

	// 3) どちらもない or ドットのみ: 桁区切りはない前提でそのまま
	return parseFloat(cleaned);
}

/**
 * 金額（小数）を最小単位の整数に変換。
 * - minorUnits=2 -> *100
 * - minorUnits=0 -> *1
 * - minorUnits=3 -> *1000
 */
export function toMinorAmountInteger(amount: number, currencyCode: string | null | undefined): number {
	// #843 通貨が分からないまま既定 2 桁へ落ちると、円の「1000」が 100000 として
	// 送信される（JPY は 0 桁）。エラーも警告も出ないので気付けない。
	// 呼び出し側に «通貨を確定させてから呼ぶ» を強制するため、ここで落とす。
	if (!currencyCode) {
		throw new Error("通貨コードが未確定のまま金額を最小単位へ変換しようとしました");
	}
	const minorUnits = getMinorUnitDigits(currencyCode);
	const factor = Math.pow(10, minorUnits);

	// 金額×係数を丸めて安全な整数に
	const value = Math.round(amount * factor);

	// 上限: JS の安全整数範囲を超えないように
	if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
		throw new Error("Amount is out of safe integer range");
	}
	return value;
}

/**
 * addressComponents から国コード (ISO-2) を抽出
 * @param addressComponents Google Places API から取得した住所コンポーネント配列
 * @returns 国コード (例: "JP", "US") または null (見つからない場合)
 */
export function extractCountryCode(addressComponents: IAddressComponent[]): string | null {
	if (!addressComponents || !Array.isArray(addressComponents)) {
		return null;
	}

	const countryComponent = addressComponents.find((component) => component.types?.includes("country"));

	return countryComponent?.shortText || null;
}

/**
 * 国コードから通貨コードを決定
 * @param countryCode ISO-3166-1 alpha-2 国コード (例: "JP", "US")
 * @returns ISO-4217 通貨コード (例: "JPY", "USD") または null (マッピングに存在しない場合)
 */
export function getCurrencyCodeFromCountry(countryCode: string | null): string | null {
	if (!countryCode) {
		return null;
	}

	return COUNTRY_TO_CURRENCY_MAP[countryCode.toUpperCase() as keyof typeof COUNTRY_TO_CURRENCY_MAP] || null;
}

/**
 * addressComponents から通貨コードを決定するメイン関数
 * @param addressComponents Google Places API から取得した住所コンポーネント配列
 * @returns ISO-4217 通貨コード (例: "JPY", "USD") または null (決定できない場合)
 */
export function getCurrencyCodeFromAddressComponents(
	addressComponents: IAddressComponent[] | null | undefined,
): string | null {
	if (!addressComponents) {
		return null;
	}

	const countryCode = extractCountryCode(addressComponents);
	return getCurrencyCodeFromCountry(countryCode);
}

/**
 * レストランデータから通貨コードを決定
 *
 * #1780 【設計】**`address_components` を先に見て、無ければ `country_code` 列へ落ちる。**
 *
 * 長らく `address_components` «だけ» を見ていたが、dev の実測で
 * **621,974 店のうち 619,498 店（99.60%）は `address_components` に country を
 * 持っていない**ことが分かった（パイプライン製の行は `'[]'`）。
 * 一方 `country_code` **列**は 621,964 店（100.00%）が埋まっている。
 *
 * つまり **国は分かっているのに、通貨だけが国を知らず**、ユーザーに通貨を
 * 選ばせていた。列を見れば、ほぼ全ての店でその手間が要らなくなる。
 *
 * ⚠️ **通貨が決まらないときに «黙って既定値» へ倒してはいけない。** JPY は
 * 小数 0 桁・USD は 2 桁で、取り違えると「1000円」が 100000 として送信される
 * （実際に起きた）。引けないときは従来どおり `null` を返し、呼び出し側が
 * ユーザーに選ばせること。
 *
 * ⚠️ 順序を入れ替えないこと。`address_components` を先に見るのは、
 * `resolveLocalLanguageCode`（api 側 #1671）と揃えるためである。
 *
 * @param restaurant レストランデータ
 * @returns ISO-4217 通貨コード または null
 */
export function getCurrencyCodeFromRestaurant(restaurant: {
	address_components?: any;
	country_code?: string | null;
}): string | null {
	return (
		getCurrencyCodeFromAddressComponents(restaurant.address_components) ??
		getCurrencyCodeFromCountry(restaurant.country_code ?? null)
	);
}

/**
 * #843 店から通貨が決まらないときに、ユーザーへ提示する候補。
 *
 * オープンデータ由来で作った店舗（619,508件）は `address_components` が空なので、
 * 店から通貨を引けない。黙って既定値を使うと金額が桁違いで記録されるため、
 * ユーザーに選ばせる。候補はここに定義した順で表示する。
 */
const CURRENCY_BY_REGION: Record<string, string> = {
	JP: "JPY",
	US: "USD",
	KR: "KRW",
	TW: "TWD",
	CN: "CNY",
	HK: "HKD",
	GB: "GBP",
	AU: "AUD",
	CA: "CAD",
	SG: "SGD",
	TH: "THB",
	VN: "VND",
	IN: "INR",
	CH: "CHF",
};

/** 選択肢として常に出す主要通貨。ロケール由来の候補を先頭へ寄せて使う。 */
export const SELECTABLE_CURRENCY_CODES = ["JPY", "USD", "EUR", "KRW", "TWD", "CNY", "GBP"] as const;

/**
 * ロケールから通貨コードを推定する。
 *
 * これは «既定値» ではなく «選択肢の初期カーソル» として使うこと。推定が外れても
 * ユーザーが選び直せる状態で提示する。黙って確定させてはいけない。
 */
export function resolveCurrencyCodeFromLocale(locale: string | null | undefined): string | null {
	if (!locale) return null;
	// "ja-JP" / "ja_JP" / "ja" のいずれも受ける。地域が無ければ言語から引く。
	const parts = locale.replace("_", "-").split("-");
	const region = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : null;
	if (region && CURRENCY_BY_REGION[region]) return CURRENCY_BY_REGION[region];

	const languageToRegion: Record<string, string> = { ja: "JP", ko: "KR", en: "US", zh: "CN", th: "TH", vi: "VN" };
	const fallbackRegion = languageToRegion[parts[0]?.toLowerCase() ?? ""];
	return fallbackRegion ? CURRENCY_BY_REGION[fallbackRegion] : null;
}

/**
 * 選択肢を «ロケール由来を先頭に» 並べ替えて返す。
 */
export function buildCurrencyChoices(locale: string | null | undefined): string[] {
	const preferred = resolveCurrencyCodeFromLocale(locale);
	const rest = SELECTABLE_CURRENCY_CODES.filter((code) => code !== preferred);
	return preferred ? [preferred, ...rest] : [...SELECTABLE_CURRENCY_CODES];
}

/**
 * レストランの Google Maps リンクを生成
 * @param restaurant レストランデータ (google_place_id と name を含む)
 * @returns Google Maps URL と開けるかどうかのフラグ
 */
export const getGoogleMapsLink = async (restaurant: Pick<SupabaseRestaurants, "google_place_id" | "name">) => {
	const placeId = restaurant.google_place_id;
	const mapUrl = `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}&query=${encodeURIComponent(restaurant.name || "")}`;
	const canOpen = await Linking.canOpenURL(mapUrl);
	return { mapUrl, canOpen };
};

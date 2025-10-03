// app-expo/lib/googlePlaces.ts
//
// Google Places 関連のユーティリティ関数
// 住所コンポーネントから通貨コードを決定する処理を提供
//

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
	AT: "EUR", BE: "EUR", CY: "EUR", EE: "EUR", FI: "EUR", FR: "EUR", DE: "EUR",
	GR: "EUR", IE: "EUR", IT: "EUR", LV: "EUR", LT: "EUR", LU: "EUR", MT: "EUR",
	NL: "EUR", PT: "EUR", SK: "EUR", SI: "EUR", ES: "EUR",
	// 追加：クロアチアは2023年からEUR
	HR: "EUR",

	// 北米・中南米
	AG: "XCD", AI: "XCD", AN: null,    // AN(蘭領アンティル)は廃止コード（保持しない場合は削除可）
	AW: "AWG", BB: "BBD", BL: "EUR", BM: "BMD", BQ: "USD", BS: "BSD", BZ: "BZD",
	BO: "BOB", BR: "BRL", CA: "CAD", CR: "CRC", CU: "CUP", CW: "ANG",
	DM: "XCD", DO: "DOP", EC: "USD", SV: "USD", GD: "XCD", GP: "EUR",
	GT: "GTQ", GY: "GYD", HN: "HNL", HT: "HTG", JM: "JMD", KN: "XCD",
	KY: "KYD", LC: "XCD", MF: "EUR", MQ: "EUR", MS: "XCD", MX: "MXN",
	NI: "NIO", PA: "PAB", PE: "PEN", PM: "EUR", PR: "USD", PY: "PYG",
	SR: "SRD", SX: "ANG", TT: "TTD", UY: "UYU", VC: "XCD", VE: "VES",

	// 欧州その他
	AD: "EUR", AL: "ALL", AM: "AMD", AX: "EUR", BA: "BAM", BG: "BGN",
	BY: "BYN", CH: "CHF", GG: "GBP", GI: "GIP", IM: "GBP", IS: "ISK",
	JE: "GBP", LI: "CHF", MC: "EUR", MD: "MDL", ME: "EUR", MK: "MKD",
	NO: "NOK", RO: "RON", RS: "RSD", SJ: "NOK", SM: "EUR", UA: "UAH",
	VA: "EUR",

	// アフリカ
	AO: "AOA", BF: "XOF", BI: "BIF", BJ: "XOF", BW: "BWP", CD: "CDF",
	CF: "XAF", CG: "XAF", CI: "XOF", CM: "XAF", CV: "CVE", DJ: "DJF",
	DZ: "DZD", EG: "EGP", EH: "MAD", ER: "ERN", ET: "ETB", GA: "XAF",
	GH: "GHS", GM: "GMD", GN: "GNF", GQ: "XAF", GW: "XOF", KE: "KES",
	KM: "KMF", LR: "LRD", LS: "LSL", LY: "LYD", MA: "MAD", MG: "MGA",
	ML: "XOF", MR: "MRU", MU: "MUR", MW: "MWK", NA: "NAD", NE: "XOF",
	NG: "NGN", RE: "EUR", RW: "RWF", SC: "SCR", SD: "SDG", SH: "SHP",
	SL: "SLE", SN: "XOF", SO: "SOS", SS: "SSP", ST: "STN", SZ: "SZL",
	TD: "XAF", TG: "XOF", TN: "TND", TZ: "TZS", UG: "UGX", YT: "EUR",
	ZA: "ZAR", ZM: "ZMW", ZW: "ZWG", // 2024年導入 ZiG (ISO: ZWG)

	// 中東
	AE: "AED", BH: "BHD", IQ: "IQD", IR: "IRR", IL: "ILS", JO: "JOD",
	KW: "KWD", LB: "LBP", OM: "OMR", PS: "ILS", QA: "QAR", SA: "SAR",
	SY: "SYP", TR: "TRY", YE: "YER",

	// アジア
	AF: "AFN", AZ: "AZN", BD: "BDT", BT: "BTN", BN: "BND", KH: "KHR",
	CN: "CNY", GE: "GEL", HK: "HKD", IN: "INR", ID: "IDR", JP: "JPY",
	KZ: "KZT", KG: "KGS", LA: "LAK", MO: "MOP", MY: "MYR", MV: "MVR",
	MN: "MNT", MM: "MMK", NP: "NPR", PK: "PKR", PH: "PHP", KR: "KRW",
	KP: "KPW", SG: "SGD", LK: "LKR", TW: "TWD", TH: "THB", TJ: "TJS",
	TM: "TMT", UZ: "UZS", VN: "VND",

	// 大洋州
	AS: "USD", AU: "AUD", CC: "AUD", CK: "NZD", CX: "AUD", FJ: "FJD",
	FM: "USD", KI: "AUD", MH: "USD", MP: "USD", NC: "XPF", NF: "AUD",
	NR: "AUD", NU: "NZD", NZ: "NZD", PG: "PGK", PN: "NZD", PW: "USD",
	SB: "SBD", TK: "NZD", TL: "USD", TO: "TOP", TV: "AUD", UM: "USD",
	VU: "VUV", WF: "XPF", WS: "WST",

	// 英仏などの本国・海外領土（補完）
	FO: "DKK", GL: "DKK", GF: "EUR",
	PF: "XPF", TF: "EUR", VG: "USD", VI: "USD", GU: "USD",
	// 南極は通貨なし
	AQ: null,
	// 念のため重複防止
} as const;

/**
 * 通貨コードから通貨記号へのマッピング表 (ISO-4217 → Currency Symbol)
 * 主要な通貨記号を収録。記号が不明な場合は通貨コードをそのまま返す。
 */
const CURRENCY_CODE_TO_SYMBOL_MAP: Record<Exclude<typeof COUNTRY_TO_CURRENCY_MAP[keyof typeof COUNTRY_TO_CURRENCY_MAP], null>, string> = {
	// Major currencies
	USD: "$",   // United States Dollar
	EUR: "€",   // Euro
	JPY: "¥",   // Japanese Yen
	GBP: "£",   // British Pound Sterling
	CNY: "¥",   // Chinese Yuan (same symbol as JPY)
	CAD: "$",   // Canadian Dollar
	AUD: "$",   // Australian Dollar
	KRW: "₩",   // South Korean Won
	CHF: "CHF", // Swiss Franc (no single-letter symbolが一般的)
	SGD: "$",   // Singapore Dollar
	HKD: "$",   // Hong Kong Dollar
	TWD: "NT$", // Taiwan Dollar（一般的に NT$）
	THB: "฿",   // Thai Baht
	VND: "₫",   // Vietnamese Dong
	MYR: "RM",  // Malaysian Ringgit
	PHP: "₱",   // Philippine Peso
	IDR: "Rp",  // Indonesian Rupiah
	INR: "₹",   // Indian Rupee
	MXN: "$",   // Mexican Peso
	BRL: "R$",  // Brazilian Real
	// ARS: "$",   // Argentine Peso
	CLP: "$",   // Chilean Peso
	COP: "$",   // Colombian Peso
	PEN: "S/",  // Peruvian Sol
	NZD: "$",   // New Zealand Dollar
	ZAR: "R",   // South African Rand
	NOK: "kr",  // Norwegian Krone
	SEK: "kr",  // Swedish Krona
	DKK: "kr",  // Danish Krone
	PLN: "zł",  // Polish Zloty
	CZK: "Kč",  // Czech Koruna
	HUF: "Ft",  // Hungarian Forint
	RUB: "₽",   // Russian Ruble
	TRY: "₺",   // Turkish Lira
	ILS: "₪",   // Israeli Shekel
	AED: "د.إ", // UAE Dirham
	SAR: "﷼",   // Saudi Riyal
	EGP: "E£",  // Egyptian Pound（£よりE£が明確）

	// 既存LATAM・カリブなど
	ISK: "kr",  // Icelandic Krona
	CRC: "₡",   // Costa Rican Colón
	PAB: "B/.", // Panamanian Balboa
	GTQ: "Q",   // Guatemalan Quetzal
	HNL: "L",   // Honduran Lempira
	NIO: "C$",  // Nicaraguan Córdoba
	BZD: "$",   // Belize Dollar
	JMD: "$",   // Jamaican Dollar
	TTD: "$",   // Trinidad and Tobago Dollar
	BSD: "$",   // Bahamian Dollar
	BBD: "$",   // Barbadian Dollar
	GYD: "$",   // Guyanese Dollar
	SRD: "$",   // Surinamese Dollar
	UYU: "$U",  // Uruguayan Peso
	PYG: "₲",   // Paraguayan Guaraní
	BOB: "Bs",  // Bolivian Boliviano
	VES: "Bs.", // Venezuelan Bolívar
	AWG: "ƒ",   // Aruban Florin
	BMD: "$",   // Bermudian Dollar
	CUP: "$",   // Cuban Peso（$MNと表記されることも）
	ANG: "ƒ",   // Netherlands Antillean Guilder
	HTG: "G",   // Haitian Gourde
	KYD: "$",   // Cayman Islands Dollar
	DOP: "RD$", // Dominican Peso
	BWP: "P",   // Botswana Pula
	CDF: "FC",  // Congolese Franc
	KPW: "₩",   // North Korean Won

	// ヨーロッパその他
	ALL: "L",     // Albanian Lek
	AMD: "֏",     // Armenian Dram
	BAM: "KM",    // Bosnia and Herzegovina Convertible Mark
	BGN: "лв",    // Bulgarian Lev
	BYN: "Br",    // Belarusian Ruble
	GIP: "£",     // Gibraltar Pound
	MDL: "L",     // Moldovan Leu
	MKD: "ден",   // Macedonian Denar
	RON: "lei",   // Romanian Leu
	RSD: "дин.",  // Serbian Dinar
	UAH: "₴",     // Ukrainian Hryvnia

	// アフリカ
	AOA: "Kz",   // Angolan Kwanza
	XOF: "CFA",  // West African CFA franc
	BIF: "FBu",  // Burundian Franc
	XAF: "FCFA", // Central African CFA franc
	CVE: "Esc",  // Cape Verdean Escudo
	DJF: "Fdj",  // Djiboutian Franc
	DZD: "د.ج",  // Algerian Dinar
	MAD: "د.م.", // Moroccan Dirham（西サハラ含む）
	ERN: "Nfk",  // Eritrean Nakfa
	ETB: "Br",   // Ethiopian Birr
	GHS: "₵",    // Ghanaian Cedi
	GMD: "D",    // Gambian Dalasi
	GNF: "FG",   // Guinean Franc
	KES: "KSh",  // Kenyan Shilling
	KMF: "Fr",   // Comorian Franc
	LRD: "$",    // Liberian Dollar
	LSL: "L",    // Lesotho Loti
	LYD: "ل.د",  // Libyan Dinar
	MGA: "Ar",   // Malagasy Ariary
	MRU: "UM",   // Mauritanian Ouguiya
	MUR: "₨",    // Mauritian Rupee
	MWK: "MK",   // Malawian Kwacha
	NAD: "$",    // Namibian Dollar
	NGN: "₦",    // Nigerian Naira
	RWF: "FRw",  // Rwandan Franc
	SCR: "₨",    // Seychellois Rupee
	SDG: "SDG",  // Sudanese Pound
	SHP: "£",    // Saint Helena Pound
	SLE: "Le",   // Sierra Leonean Leone（新Leone）
	SOS: "Sh",   // Somali Shilling
	SSP: "£",    // South Sudanese Pound
	STN: "Db",   // São Tomé and Príncipe Dobra
	SZL: "L",    // Eswatini Lilangeni
	TND: "د.ت",  // Tunisian Dinar
	TZS: "TSh",  // Tanzanian Shilling
	UGX: "USh",  // Ugandan Shilling
	ZMW: "ZK",   // Zambian Kwacha
	ZWG: "ZiG",  // Zimbabwe Gold (ZiG, 2024-)

	// 中東
	BHD: "د.ب",  // Bahraini Dinar
	IQD: "ع.د",  // Iraqi Dinar
	IRR: "﷼",    // Iranian Rial
	JOD: "د.ا",  // Jordanian Dinar
	KWD: "د.ك",  // Kuwaiti Dinar
	LBP: "ل.ل",  // Lebanese Pound
	OMR: "ر.ع.", // Omani Rial
	QAR: "ر.ق",  // Qatari Riyal
	SYP: "£",    // Syrian Pound
	YER: "﷼",    // Yemeni Rial

	// アジア
	AFN: "؋",    // Afghan Afghani
	AZN: "₼",    // Azerbaijani Manat
	BDT: "৳",    // Bangladeshi Taka
	BTN: "Nu.",  // Bhutanese Ngultrum
	BND: "$",    // Brunei Dollar
	KHR: "៛",    // Cambodian Riel
	GEL: "₾",    // Georgian Lari
	KZT: "₸",    // Kazakhstani Tenge
	KGS: "som",  // Kyrgyzstani Som
	LAK: "₭",    // Lao Kip
	MOP: "MOP$", // Macanese Pataca
	MVR: "MVR",  // Maldivian Rufiyaa（記号は一般的でないためISO表記）
	MNT: "₮",    // Mongolian Tögrög
	MMK: "Ks",   // Myanmar Kyat
	NPR: "Rs",   // Nepalese Rupee
	PKR: "₨",    // Pakistani Rupee
	LKR: "Rs",   // Sri Lankan Rupee
	TJS: "SM",   // Tajikistani Somoni
	TMT: "m",    // Turkmenistan Manat
	UZS: "so'm", // Uzbekistani So'm

	// 大洋州
	FJD: "$",   // Fijian Dollar
	PGK: "K",   // Papua New Guinean Kina
	SBD: "$",   // Solomon Islands Dollar
	TOP: "T$",  // Tongan Paʻanga
	VUV: "Vt",  // Vanuatu Vatu
	WST: "T",   // Samoan Tālā

	// 準地域通貨・通貨同盟
	XCD: "$",   // East Caribbean Dollar
	XPF: "₣",   // CFP Franc
};

/**
 * 通貨コードから通貨記号を取得
 * @param currencyCode ISO-4217 通貨コード (例: "JPY", "USD")
 * @returns 通貨記号 (例: "¥", "$") または通貨コード自体 (マッピングに存在しない場合)
 */
export function getCurrencySymbol(currencyCode: string | null): string {
	if (!currencyCode) {
		return "";
	}

	return CURRENCY_CODE_TO_SYMBOL_MAP[currencyCode.toUpperCase() as keyof typeof CURRENCY_CODE_TO_SYMBOL_MAP] || currencyCode;
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
 * @param restaurant レストランデータ (address_components を含む)
 * @returns ISO-4217 通貨コード または null
 */
export function getCurrencyCodeFromRestaurant(restaurant: { address_components?: any }): string | null {
	return getCurrencyCodeFromAddressComponents(restaurant.address_components);
}

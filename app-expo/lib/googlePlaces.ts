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
 * 主要な国のみを収録。正確性を重視し、不明な場合は null を返す。
 */
const COUNTRY_TO_CURRENCY_MAP: Record<string, string> = {
	// Major currencies
	US: "USD", // United States Dollar
	EU: "EUR", // Euro (多くのEU諸国で使用)
	JP: "JPY", // Japanese Yen
	GB: "GBP", // British Pound Sterling
	CN: "CNY", // Chinese Yuan
	CA: "CAD", // Canadian Dollar
	AU: "AUD", // Australian Dollar
	KR: "KRW", // South Korean Won
	CH: "CHF", // Swiss Franc
	SG: "SGD", // Singapore Dollar
	HK: "HKD", // Hong Kong Dollar
	TW: "TWD", // Taiwan Dollar
	TH: "THB", // Thai Baht
	VN: "VND", // Vietnamese Dong
	MY: "MYR", // Malaysian Ringgit
	PH: "PHP", // Philippine Peso
	ID: "IDR", // Indonesian Rupiah
	IN: "INR", // Indian Rupee
	MX: "MXN", // Mexican Peso
	BR: "BRL", // Brazilian Real
	AR: "ARS", // Argentine Peso
	CL: "CLP", // Chilean Peso
	CO: "COP", // Colombian Peso
	PE: "PEN", // Peruvian Sol
	NZ: "NZD", // New Zealand Dollar
	ZA: "ZAR", // South African Rand
	NO: "NOK", // Norwegian Krone
	SE: "SEK", // Swedish Krona
	DK: "DKK", // Danish Krone
	PL: "PLN", // Polish Zloty
	CZ: "CZK", // Czech Koruna
	HU: "HUF", // Hungarian Forint
	RU: "RUB", // Russian Ruble
	TR: "TRY", // Turkish Lira
	IL: "ILS", // Israeli Shekel
	AE: "AED", // UAE Dirham
	SA: "SAR", // Saudi Riyal
	EG: "EGP", // Egyptian Pound

	// Euro zone countries (using EUR)
	AT: "EUR", // Austria
	BE: "EUR", // Belgium
	CY: "EUR", // Cyprus
	EE: "EUR", // Estonia
	FI: "EUR", // Finland
	FR: "EUR", // France
	DE: "EUR", // Germany
	GR: "EUR", // Greece
	IE: "EUR", // Ireland
	IT: "EUR", // Italy
	LV: "EUR", // Latvia
	LT: "EUR", // Lithuania
	LU: "EUR", // Luxembourg
	MT: "EUR", // Malta
	NL: "EUR", // Netherlands
	PT: "EUR", // Portugal
	SK: "EUR", // Slovakia
	SI: "EUR", // Slovenia
	ES: "EUR", // Spain

	// Additional countries
	IS: "ISK", // Iceland
	CR: "CRC", // Costa Rica
	PA: "PAB", // Panama (also uses USD)
	GT: "GTQ", // Guatemala
	HN: "HNL", // Honduras
	NI: "NIO", // Nicaragua
	SV: "USD", // El Salvador (uses USD)
	BZ: "BZD", // Belize
	JM: "JMD", // Jamaica
	TT: "TTD", // Trinidad and Tobago
	BS: "BSD", // Bahamas
	BB: "BBD", // Barbados
	GY: "GYD", // Guyana
	SR: "SRD", // Suriname
	UY: "UYU", // Uruguay
	PY: "PYG", // Paraguay
	BO: "BOB", // Bolivia
	EC: "USD", // Ecuador (uses USD)
	VE: "VES", // Venezuela
};

/**
 * 通貨コードから通貨記号へのマッピング表 (ISO-4217 → Currency Symbol)
 * 主要な通貨記号を収録。記号が不明な場合は通貨コードをそのまま返す。
 */
const CURRENCY_CODE_TO_SYMBOL_MAP: Record<string, string> = {
	// Major currencies
	USD: "$", // United States Dollar
	EUR: "€", // Euro
	JPY: "¥", // Japanese Yen
	GBP: "£", // British Pound Sterling
	CNY: "¥", // Chinese Yuan (same symbol as JPY)
	CAD: "$", // Canadian Dollar
	AUD: "$", // Australian Dollar
	KRW: "₩", // South Korean Won
	CHF: "CHF", // Swiss Franc (no common symbol)
	SGD: "$", // Singapore Dollar
	HKD: "$", // Hong Kong Dollar
	TWD: "$", // Taiwan Dollar
	THB: "฿", // Thai Baht
	VND: "₫", // Vietnamese Dong
	MYR: "RM", // Malaysian Ringgit
	PHP: "₱", // Philippine Peso
	IDR: "Rp", // Indonesian Rupiah
	INR: "₹", // Indian Rupee
	MXN: "$", // Mexican Peso
	BRL: "R$", // Brazilian Real
	ARS: "$", // Argentine Peso
	CLP: "$", // Chilean Peso
	COP: "$", // Colombian Peso
	PEN: "S/", // Peruvian Sol
	NZD: "$", // New Zealand Dollar
	ZAR: "R", // South African Rand
	NOK: "kr", // Norwegian Krone
	SEK: "kr", // Swedish Krona
	DKK: "kr", // Danish Krone
	PLN: "zł", // Polish Zloty
	CZK: "Kč", // Czech Koruna
	HUF: "Ft", // Hungarian Forint
	RUB: "₽", // Russian Ruble
	TRY: "₺", // Turkish Lira
	ILS: "₪", // Israeli Shekel
	AED: "د.إ", // UAE Dirham
	SAR: "﷼", // Saudi Riyal
	EGP: "£", // Egyptian Pound
	ISK: "kr", // Icelandic Krona
	CRC: "₡", // Costa Rican Colon
	PAB: "B/.", // Panamanian Balboa
	GTQ: "Q", // Guatemalan Quetzal
	HNL: "L", // Honduran Lempira
	NIO: "C$", // Nicaraguan Cordoba
	BZD: "$", // Belize Dollar
	JMD: "$", // Jamaican Dollar
	TTD: "$", // Trinidad and Tobago Dollar
	BSD: "$", // Bahamian Dollar
	BBD: "$", // Barbadian Dollar
	GYD: "$", // Guyanese Dollar
	SRD: "$", // Surinamese Dollar
	UYU: "$", // Uruguayan Peso
	PYG: "₲", // Paraguayan Guarani
	BOB: "Bs", // Bolivian Boliviano
	VES: "Bs", // Venezuelan Bolivar
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

	return CURRENCY_CODE_TO_SYMBOL_MAP[currencyCode.toUpperCase()] || currencyCode;
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

	return COUNTRY_TO_CURRENCY_MAP[countryCode.toUpperCase()] || null;
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

// app-expo/lib/googlePlaces.ts
//
// Google Places 関連のユーティリティ関数
// 住所コンポーネントから通貨コードを決定する処理を提供
//

/**
 * Google Places API の AddressComponent 型定義
 */
export interface AddressComponent {
	longText?: string;
	shortText?: string;
	types?: string[];
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
 * addressComponents から国コード (ISO-2) を抽出
 * @param addressComponents Google Places API から取得した住所コンポーネント配列
 * @returns 国コード (例: "JP", "US") または null (見つからない場合)
 */
export function extractCountryCode(addressComponents: AddressComponent[]): string | null {
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
	addressComponents: AddressComponent[] | null | undefined,
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

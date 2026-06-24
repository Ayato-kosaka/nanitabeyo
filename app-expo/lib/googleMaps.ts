/**
 * Google Maps の検索 URL を生成する。
 *
 * 0件 fallback では、アプリ側の検索意図を Google Maps 側に引き継ぐために使う。
 */
export const buildGoogleMapsSearchUrl = (
	category: string,
	location: { latitude: number; longitude: number },
	options?: {
		zoom?: number;
		hl?: string;
	},
) => {
	const zoom = options?.zoom ?? 14;
	const lat = Number(location.latitude.toFixed(7));
	const lng = Number(location.longitude.toFixed(7));
	const encodedCategory = encodeURIComponent(category);

	const url = new URL(`https://www.google.com/maps/search/${encodedCategory}/@${lat},${lng},${zoom}z`);

	if (options?.hl) {
		url.searchParams.set("hl", options.hl);
	}

	return url.toString();
};

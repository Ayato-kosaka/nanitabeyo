// Example usage of Google Places currency mapping
// This demonstrates how the currency code determination works

import { getCurrencyCodeFromAddressComponents } from "../lib/googlePlaces";

// Example: Japanese restaurant
const japanRestaurant = {
	address_components: [
		{
			longText: "Tokyo",
			shortText: "Tokyo",
			types: ["locality", "political"],
		},
		{
			longText: "Japan",
			shortText: "JP",
			types: ["country", "political"],
		},
	],
};

// Example: US restaurant
const usaRestaurant = {
	address_components: [
		{
			longText: "New York",
			shortText: "New York",
			types: ["locality", "political"],
		},
		{
			longText: "United States",
			shortText: "US",
			types: ["country", "political"],
		},
	],
};

// Example: German restaurant
const germanyRestaurant = {
	address_components: [
		{
			longText: "Berlin",
			shortText: "Berlin",
			types: ["locality", "political"],
		},
		{
			longText: "Germany",
			shortText: "DE",
			types: ["country", "political"],
		},
	],
};

// Example usage in a component
export function ExampleUsage() {
	// Get currency codes for different restaurants
	const japanCurrency = getCurrencyCodeFromAddressComponents(japanRestaurant.address_components);
	const usaCurrency = getCurrencyCodeFromAddressComponents(usaRestaurant.address_components);
	const germanyCurrency = getCurrencyCodeFromAddressComponents(germanyRestaurant.address_components);

	console.log("Japan restaurant currency:", japanCurrency); // "JPY"
	console.log("USA restaurant currency:", usaCurrency); // "USD"
	console.log("Germany restaurant currency:", germanyCurrency); // "EUR"

	return {
		japanCurrency,
		usaCurrency,
		germanyCurrency,
	};
}

// Example of how this would be used in a review component
export function ReviewPriceDisplay({
	price_cents,
	restaurant,
}: {
	price_cents: number;
	restaurant: { address_components?: any };
}) {
	const currencyCode = getCurrencyCodeFromAddressComponents(restaurant.address_components);

	if (!currencyCode) {
		// No currency determined - display without currency symbol
		return `${price_cents / 100}`;
	}

	// Format price with appropriate currency
	const formatter = new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currencyCode,
		minimumFractionDigits: 0,
	});

	return formatter.format(price_cents / 100);
}

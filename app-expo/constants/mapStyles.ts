/**
 * Google Maps style configuration to show only food-related POIs
 * This style hides all POI categories except restaurants, cafes, and food establishments
 */
export const foodOnlyMapStyle = [
	// Hide all POI by default
	{
		featureType: "poi",
		stylers: [{ visibility: "off" }],
	},
	// Show only food-related POI
	{
		featureType: "poi.business",
		elementType: "labels",
		stylers: [{ visibility: "off" }],
	},
	{
		featureType: "poi.government",
		stylers: [{ visibility: "off" }],
	},
	{
		featureType: "poi.medical",
		stylers: [{ visibility: "off" }],
	},
	{
		featureType: "poi.park",
		stylers: [{ visibility: "off" }],
	},
	{
		featureType: "poi.place_of_worship",
		stylers: [{ visibility: "off" }],
	},
	{
		featureType: "poi.school",
		stylers: [{ visibility: "off" }],
	},
	{
		featureType: "poi.sports_complex",
		stylers: [{ visibility: "off" }],
	},
	{
		featureType: "poi.attraction",
		stylers: [{ visibility: "off" }],
	},
	// Note: Google Maps doesn't have a specific "poi.business.food" feature type
	// in the styling API. The approach is to hide all POIs and rely on the
	// business search results for restaurant markers shown via the app
];

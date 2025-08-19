const { withInfoPlist, withStringsXml, IOSConfig, AndroidConfig } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Custom Expo config plugin to add localized app names
 * for iOS and Android based on the locale files.
 */

// Mapping of locales to their display names
const LOCALIZED_APP_NAMES = {
	ja: "なに食べよ",
	"ja-JP": "なに食べよ",
	en: "CraveCatch",
	"en-US": "CraveCatch",
	fr: "CraveCatch",
	"fr-FR": "CraveCatch",
	es: "CraveCatch",
	"es-ES": "CraveCatch",
	zh: "CraveCatch",
	"zh-CN": "CraveCatch",
	ko: "CraveCatch",
	"ko-KR": "CraveCatch",
	ar: "CraveCatch",
	"ar-SA": "CraveCatch",
	hi: "CraveCatch",
	"hi-IN": "CraveCatch",
};

function withLocalizedAppName(config) {
	// Configure iOS localization
	config = withInfoPlist(config, (config) => {
		// Enable mixed localizations
		config.modResults.CFBundleAllowMixedLocalizations = true;

		// Set default display name to CraveCatch (fallback)
		config.modResults.CFBundleDisplayName = "CraveCatch";

		// Set localized app names for iOS
		config.modResults.CFBundleLocalizations = Object.keys(LOCALIZED_APP_NAMES);

		return config;
	});

	// Configure Android localization with default strings
	config = withStringsXml(config, (config) => {
		// Add default app name
		config.modResults = config.modResults || {};
		config.modResults.resources = config.modResults.resources || {};
		config.modResults.resources.string = config.modResults.resources.string || [];

		// Add app_name string resource (default: CraveCatch)
		const existingAppName = config.modResults.resources.string.find((item) => item.$.name === "app_name");

		if (!existingAppName) {
			config.modResults.resources.string.push({
				$: { name: "app_name" },
				_: "CraveCatch", // Default to CraveCatch
			});
		} else {
			existingAppName._ = "CraveCatch";
		}

		return config;
	});

	return config;
}

module.exports = withLocalizedAppName;

module.exports = withLocalizedAppName;

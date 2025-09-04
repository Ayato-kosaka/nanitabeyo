# Google Places Currency Mapping Implementation

This implementation adds support for storing Google Places `address_components` and `plus_code` data in the `restaurants` table and provides client-side currency code determination functionality.

## Database Changes

### Schema Updates

- Added `address_components` (jsonb) column to `restaurants` table
- Added `plus_code` (jsonb) column to `restaurants` table
- Updated Supabase database types to include new fields
- Updated Prisma converters to handle the new fields

## API Changes

### Google Places Integration

- Modified field mask in `locations.service.ts` to include `places.addressComponents`
- Updated `bulkImportFromGoogle` in `dishes.service.ts` to capture and store:
  - `place.addressComponents` → `restaurant.address_components`
  - `place.plusCode` → `restaurant.plus_code`

## Client-Side Currency Mapping

### Core Library (`app-expo/lib/googlePlaces.ts`)

Provides comprehensive currency mapping functionality:

- **`extractCountryCode(addressComponents)`** - Extracts ISO-2 country code from Google Places address components
- **`getCurrencyCodeFromCountry(countryCode)`** - Maps country code to ISO-4217 currency code
- **`getCurrencyCodeFromAddressComponents(addressComponents)`** - Main function for currency determination
- **`getCurrencyCodeFromRestaurant(restaurant)`** - Convenience function for restaurant objects

### Supported Countries/Currencies

Includes mapping for 50+ countries including:

- Major currencies: USD, EUR, JPY, GBP, CNY, CAD, AUD, etc.
- Regional currencies: KRW, SGD, HKD, TWD, THB, etc.
- European Union countries automatically mapped to EUR
- Conservative approach: Returns `null` for unknown countries

### Usage Example

```typescript
import { getCurrencyCodeFromRestaurant } from "@/lib/googlePlaces";

const restaurant = {
	address_components: [{ shortText: "JP", types: ["country", "political"] }],
};

const currency = getCurrencyCodeFromRestaurant(restaurant);
// Returns: "JPY"
```

## Key Features

1. **Data Preservation**: Full Google Places `address_components` and `plus_code` are stored for future use
2. **Conservative Mapping**: Only maps known countries to avoid incorrect assumptions
3. **Type Safety**: Full TypeScript support with proper type definitions
4. **Extensible**: Easy to add new country-currency mappings
5. **Error Handling**: Graceful handling of missing or invalid data

## Impact

This implementation enables:

- Consistent currency display in restaurant reviews
- Automatic currency code determination based on restaurant location
- Future analysis and processing of restaurant location data
- Support for international restaurant reviews with proper currency formatting

All changes are backward compatible and maintain existing functionality while adding the new capabilities.

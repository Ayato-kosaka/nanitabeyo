# Store Smart Link `/store`

This document describes the smart link route that funnels users to the
appropriate destination when visiting `https://food-scroll.web.app/store`.

## Behaviour

| Platform                            | Result                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **iOS/Android (app installed)**     | Attempts to open the app via Universal/App Links. When rendered in the app it immediately navigates to `/`. |
| **iOS/Android (app not installed)** | After trying to open the app, redirects to the App Store or Google Play after ~800 ms.                      |
| **Desktop browsers**                | Redirects to `https://food-scroll.web.app/`.                                                                |

The implementation also tries the custom scheme `nanitabeyo:/` on iOS as a
fallback.

## Verification Steps

1. **Mobile with app installed**
   - Open `https://food-scroll.web.app/store` from a message or browser.
   - The app should launch and display the home screen (`/`).
2. **Mobile without app installed**
   - Open the same URL.
   - After a short pause you should be redirected to the respective store.
3. **Desktop**
   - Open the URL in a desktop browser.
   - You should immediately be redirected to `https://food-scroll.web.app/`.

## Configuration

The following environment variables are used:

- `EXPO_PUBLIC_WEB_BASE_URL`
- `EXPO_PUBLIC_APP_STORE_URL`
- `EXPO_PUBLIC_PLAY_STORE_URL`

Universal Links (iOS) and App Links (Android) must also be configured for the
`food-scroll.web.app` domain. A custom scheme `nanitabeyo` is used as a fallback
on iOS.

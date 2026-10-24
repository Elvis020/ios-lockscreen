# iOS wallpaper refresh

## Current behavior

Telegram and the dashboard save settings to the shared account. The wallpaper endpoint
renders those settings as a PNG when requested. An iOS Shortcut must download and apply
that image; the server cannot change the wallpaper already installed on the phone.

Use the read-only wallpaper URL from `/url` when configuring the Shortcut. Do not put
the management token or bot credentials into a shared Shortcut.

For genuine native SF text without hosting Apple font files, the optional
[on-iPhone rendering prototype](./native-ios-rendering.md) uses Scriptable between
the data fetch and wallpaper action. It is a separate test Shortcut, not a verified
replacement for the current PNG flow.

## Agreed next step: refresh when leaving Telegram

Status: agreed approach, deferred until the wallpaper layout work is complete. The
automation has not been installed or verified on the target iPhone (iOS 26.6.2).

Configure a personal automation on the phone:

1. Choose the **App** trigger and select **Telegram**.
2. Select **Is Closed**. This includes switching away from Telegram, not just quitting.
3. Choose **Run Immediately**, or disable **Ask Before Running** if that label is shown.
4. Run the existing wallpaper Shortcut, which downloads the image and sets the wallpaper.
5. Run it once while unlocked, approve required permissions, and disable wallpaper
   preview/confirmation in the wallpaper action where available.

After a successful bot reply, switch to another app or the Home Screen and check the
lock screen. Test locked-phone behavior separately; individual actions may still
require interaction. This trigger applies to leaving Telegram generally, not one bot.

Add a daily refresh later to advance the calendar even when no settings have changed.
Changing settings from Telegram Desktop does not trigger the phone's app-close
automation.

## Deferred improvements

- Check a wallpaper revision and local date before downloading unchanged content.
- Record a device acknowledgment after the wallpaper action, not merely an image fetch.
- Refresh stale Google Calendar data separately; the current image fetch uses cached
  Google events, and `/sync` or dashboard sync refreshes that cache.
- Keep a manual refresh as recovery for network or automation failures.

Email wake-ups, Pushcut integration, and remote Send-button triggers are not part of
the agreed implementation.

## References

- [Apple: app-open and app-close triggers (iOS 26)](https://support.apple.com/en-euro/guide/shortcuts/apde31e9638b/9.0/ios/26)
- [Apple: automatic personal automations (iOS 26)](https://support.apple.com/en-euro/guide/shortcuts/apd602971e63/9.0/ios/26)

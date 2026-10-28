# Lock Screen countdown widget

This widget adds the live final-day countdown without creating 23 hourly Shortcuts
automations. Keep the existing midnight wallpaper automation: it still refreshes the
wallpaper once per day. The separate widget uses iOS's system timer text, so the
visible countdown continues changing without rerunning the script every hour.

## Set up the widget

1. Install Scriptable on the iPhone and open it once.
2. Create a script named **Calendar Countdown** and paste the full contents of
   [`countdown-widget.js`](../scripts/scriptable/countdown-widget.js).
3. Run the script inside Scriptable. Paste the existing HTTPS wallpaper URL from the
   bot's `/url` command and tap **Save**.
4. Unlock the iPhone, touch and hold the Lock Screen, then choose **Customize** and
   **Lock Screen**.
5. Tap the widget area below the clock, choose **Scriptable**, and add its rectangular
   widget. Tap the placed widget and select **Calendar Countdown** as the script.
6. Tap **Done**. The rectangular widget shows the event name on the left and its day
   label or live timer on the right. Inline and circular styles show only the countdown.
7. Leave the existing 12 a.m. wallpaper automation unchanged.

Run the script interactively again whenever the wallpaper URL changes. The validated
countdown endpoint, including its read-only key, is stored in Scriptable Keychain. The
widget fetches only the chronologically next eligible manual or selected Google event
and does not save the event response. Anyone with the wallpaper URL can read the
personalized wallpaper and countdown, so keep the URL private.

## Timing behavior and limits

Events currently store dates, not start times. The countdown therefore targets the
start of the event date in the account's configured time zone. During the final 24
elapsed hours, Scriptable hands the deadline to iOS's system timer. iOS chooses the
exact display format and may show minutes or seconds as well as hours.

Widget refresh requests are best-effort. iOS may load the next event, switch from a
day label to the timer, or replace an expired timer later than requested, especially
in Low Power Mode. The timer text itself updates without hourly automations after iOS
has loaded it. Verify the rectangular layout and midnight transition on the target
iPhone before relying on it.

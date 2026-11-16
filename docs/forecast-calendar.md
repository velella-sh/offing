---
title: Export a forecast calendar
description: Put your repository's lifecycle dates in Google Calendar, Apple Calendar, or Outlook.
---

# Export a forecast calendar

Run the forecast from your repository and save its lifecycle dates to an iCalendar file.

```bash
offing forecast . --months 12 --ics forecast.ics
```

Use `--ics` without a filename to write the calendar to stdout. Add `--force` to
replace an existing output file. Place the repository path before `--ics` when
supplying both paths.

Each dated lifecycle rule that affects the repository gets an all-day event. Its
description lists the affected files, suggested replacements when available, and
the lifecycle source. Offing includes 90- and 30-day reminders whose trigger dates
are on or after the forecast's reference day. Use `--as-of <YYYY-MM-DD>` to set
that day. Check reminder settings after importing, since calendar apps control
notification delivery.

## Import a local file

- **Google Calendar on the web.** In **Settings → Import & export**, select the
  `.ics` file, choose a destination calendar, and click **Import**. [Google Calendar Help](https://support.google.com/calendar/answer/37118)
- **Apple Calendar on Mac.** Choose **File → Import**, select the `.ics` file, and
  choose a destination calendar. [Apple Calendar Help](https://support.apple.com/guide/calendar/icl1023/mac)
- **Outlook on the web.** Open **Calendar → Add calendar → Upload from file**.
  Select the `.ics` file and the destination calendar, then import it. [Microsoft Support](https://support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web)

An import captures the events in the file at that moment. Use a dedicated
calendar if you plan to replace that set of events with a fresh export.

## Subscribe to a published URL

Offing writes the file locally. A subscription needs a stable URL that your
calendar provider can reach. If your team publishes the file there, replace it
with each fresh export. Review who can access the URL because event descriptions
include repository-relative paths.

- **Google Calendar on the web.** Choose **Other calendars → Add other calendars
  → From URL** and enter the public calendar URL. [Google Calendar Help](https://support.google.com/calendar/answer/37100)
- **Apple Calendar on Mac.** Choose **File → New Calendar Subscription**, enter
  the URL, and click **Subscribe**. [Apple Calendar Help](https://support.apple.com/guide/calendar/subscribe-to-calendars-icl1022/mac)
- **Outlook on the web.** Choose **Calendar → Add calendar → Subscribe from web**,
  enter the URL, and save the subscription. [Microsoft Support](https://support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web)

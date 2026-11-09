> **Partly superseded 2026-11-09:** the chosen feature is now `intent-cleaning-reports.md` (standalone, no Le Register data). Directions A, B and C below are not being built.

# Intent: n8n features that complement Le Register

Source: brainstorm of 2026-11-09 (102 ideas, 9 techniques). Input for `bmad-product-brief` or `bmad-prd`.

## Context

- **Le Register:** a Telegram bot that records phone bookings for one owner of 40 chalets. Python, long polling, SQLite outside the repo, owner-only, append-only journal. Planned: overlap alerts, ratings, an 08:00 morning summary, a Trello register.
- **n8n:** runs locally in Docker at `127.0.0.1:5678`, free, single container, one named volume (`n8n_data`).
- **Goal:** cut the owner's daily admin (2-3 hours to under 30 minutes), catch every overlap, and keep running cost near zero.

## Chosen directions

**A. Safety net (start here).** n8n watches the bot from outside.
- Nightly backup of the bot's SQLite file.
- Alert if the 08:00 summary was not sent by 08:15.
- Weekly canary command proving the bot still answers.
- Daily alert for outbox rows stuck in retry (a deferred gap in Le Register).

**B. Unified overlap check.** n8n reads the Booking.com, Airbnb and website iCal feeds and runs one overlap check across them and the phone bookings. This closes the gap the product brief accepts.

**C. Daily ops board.** One morning message from the booking export: arrivals, departures, same-day turnovers and open alerts. The same export can drive a cleaner checklist, a calendar per chalet, and the Trello register. That could move Epics 4 and 5 out of the bot.

## Enabler (required for A, B and C)

Le Register writes a booking export (CSV or JSON) into a folder that the n8n container can read. n8n cannot read the bot's SQLite file directly, and it should not poll the bot's token.

## Constraints

- **Cost:** must stay free (self-hosted n8n, Telegram Bot API, Groq free tier).
- **Polling conflict:** only one program may poll a bot token, so n8n must not read the owner bot's messages. Staff and guest features need a second bot; sending through the Bot API is fine.
- **No inbound access:** n8n is bound to localhost, so no webhooks from outside. Use polling and schedules.
- **Uptime:** scheduled jobs need the host to be on. An always-on machine is needed for 08:00 jobs.
- **Safety:** guest-facing messages need owner approval first. Phone numbers must not appear in n8n logs. One automated message per guest per day.

## Open questions

- Where does the export live, and how does n8n see it (mounted folder, or a small read-only endpoint on the bot)?
- Does the owner want Epics 4 and 5 built in the bot or in n8n?
- Which free channel reaches guests, since WhatsApp is not free?
- Is the n8n host always on during the season?

## Parked ideas (not chosen)

Guest arrival and review messages, voice-note bookings, lock codes, deposit tracking, dynamic pricing, weather alerts, a public availability page, and a weekly AI review of the journal (a free start on phase-2 predictions).

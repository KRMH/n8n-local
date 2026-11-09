# Intent: cleaning reports and owner-staff messaging (n8n)

Status: chosen direction, design draft. Date: 2026-11-09. Supersedes `design-nightly-backup.md` and directions A, B and C in `brainstorm-intent.md`, which tied n8n to Le Register or needed APIs you don't have yet.

## Scope

n8n runs a Telegram bot for the cleaning staff. It is **standalone**: it reads nothing from Le Register and shares no file, database or bot with it.

- Staff send reports to the bot ("chalet 12, heater broken", with an optional photo).
- The owner sends messages to one employee or to everyone, through the same bot.
- Every message, in both directions, is logged.
- The owner can mark a report closed, and sees what is still open.

## Turnover cleaning (added 2026-11-09)

When guests leave, the chalet needs cleaning. This is a second thing the bot tracks, next to reports, and it is separate from them.

**Who:** the owner or any employee on the allow list can start it, hand it over, or take it.

**Cleaning is the only kind of task.** There is no list of task kinds. Any employee can work on any chalet: chalets are not assigned to people. A chalet can have several cleaning tasks at once. Each task is **one task with one or more workers**: two people cleaning chalet 12 together share a single task, they do not get two.

| Step | Command (examples) | Result |
| --- | --- | --- |
| Guests left | `left 12` (or "clients left 12") | A cleaning task for chalet 12 is created as **pending**, with number `T5`. The owner and all employees are told. If chalet 12 already has open tasks, the reply also lists them |
| Hand it to a person | `assign T5 maria` or `assign T5 maria, jean` | Status **assigned**; each named person is told. It is a hand-over for this one task and does not tie anyone to a chalet. Anyone allowed can do this, including an employee passing it on |
| Start directly | `start T5` | Status **in progress**; the sender is added as a worker. Several people can start the same task, and each is added |
| Leave it | (nothing) | Stays **pending** and shows in `open` and the morning reminder |
| Step away | `leave T5` | The sender is removed from the workers. With no workers left the task returns to **pending** (or **assigned** if still assigned) |
| Finish | `finish T5` | Status **done** for the whole task. Allowed for any worker on the task and for the owner. All workers and the owner are told |

Rules:
- A chalet may have any number of open tasks. Creating one never fails; if others are open for that chalet, the reply lists them so a duplicate is easy to spot.
- Commands can use the chalet number when only one task is open there (`start 12`). If the chalet has several open tasks, the bot lists them with their numbers and asks the sender to repeat with `T5`.
- Everyone working on a task sees the same status. When someone starts, finishes or leaves, the other workers are told.
- A pending task nobody takes within a set time pings the owner, like urgent reports (setting `pending_task_minutes`, default 120, same quiet hours).
- Only the owner or a worker on the task can finish it. Other employees get "You are not on T5. Send `start T5` first."
- Every step is logged: time, task, chalet, who did it, old and new status. A `tasks` table keeps the current state, and a `task_workers` table lists who is on each task.
- Reports and tasks use different numbers: reports are `#17`, tasks are `T5`, and a bare number means a chalet. So `close #17` closes a report, `finish T5` finishes a task, and `@12` messages the people working on chalet 12.

## Users

- **Owner:** one account.
- **Employees:** a small named list (cleaners, maintenance). Anyone not on the list is ignored.

## Core flows

1. **Report in:** employee sends a message. n8n logs it, assigns a report number, replies "Received #17", and forwards it to the owner.
2. **Owner out:** the owner sends `@maria bring linen to 12`, `@12 check the heater` (everyone currently working on an open task at chalet 12) or `@all`. n8n delivers it and logs it.
3. **Owner reply:** the owner replies to a forwarded report. n8n sends it to the employee who wrote it and logs it.
4. **Close:** the owner sends `close #17`. n8n marks it closed and tells the employee.
5. **Open list:** the owner sends `open` and gets all unclosed reports. Optional: a morning list of what is still open.

## Technical decisions

- **No inbound access (keeps AD-3).** Telegram's webhook trigger needs a public HTTPS address, and n8n is local-only. The workflow instead polls `getUpdates` every minute with the HTTP Request node, keeping the update offset in the workflow's static data. Delay is up to one minute. A tunnel is a later upgrade.
- **Its own bot.** A new bot made in @BotFather. No conflict with Le Register, whose bot token is never shared.
- **The log.** n8n's built-in Data tables (confirm they exist in 2.46.6), so no outside account is needed. Each row: time, direction, sender, recipient, chalet, text, photo file id, report number, priority, status. Export to CSV from the UI. Other tables: `allowlist`, `settings`, `messages`.
- **Allow list.** A table of Telegram user ids with name and role. Messages from anyone else are dropped silently, like Le Register's owner-only gate.
- **Telegram limits.** A bot can only message people who have sent it `/start` first. Each employee must do that once.
- **Backup.** The log lives in the `n8n_data` volume, so the README's volume backup covers it. Photos are stored by Telegram file id, not downloaded, in the first version.

## Out of scope (first version)

Bookings or any Le Register data, guest messaging, checklists, translation, payments, webhooks and tunnels.

## Decisions (2026-11-09)

- **Users:** all employees use Telegram.
- **Language is a setting.** Every reply the bot sends comes from a `messages` Data table keyed by message id and language (for example `received`, `closed`, `not_allowed`). A `settings` table holds the active language, set to `en` for now. Adding French later means adding rows and changing the setting, with no workflow edits. A per-employee language column in the allow list is possible later.
- **Priority:** two levels, `urgent` and `normal` (default). An employee marks a report urgent by starting it with `!` or `urgent`. Urgent reports reach the owner with a flag, are listed first by `open`, and appear in the morning reminder.
- **Photos:** referenced only. The log stores Telegram's file id and the caption; nothing is downloaded. Telegram keeps the file, so the photo can be opened from the log while Telegram still serves it.

- **Message by chalet:** the owner can write `@12 check the heater`. Chalets are not assigned to people, so n8n sends it to the workers on open tasks at chalet 12. If nobody is working there, the owner gets "Nobody is working at chalet 12. Send it with @all or @name instead." and nothing is sent. Targets are now `@name`, `@12` (chalet) or `@all`. A report that mentions a chalet number also records it in the log's chalet column.
- **Urgent reports ping again:** a second workflow runs every 10 minutes and finds urgent reports that are still open. It re-pings the owner when the settings say it is time: every `urgent_repeat_minutes` (default 60), at most `urgent_max_repeats` times (default 3), and not during quiet hours (default 22:00 to 07:00, shown in the settings table). Each ping is logged. After the last repeat the report stays on the `open` list and in the morning reminder. Closing the report (`close #17`) stops the pings.

## Open questions

- Is `assign T5 maria` still wanted as a hand-over, now that chalets are not assigned to people? (Draft: yes, for one task.)
- Should "guests left" notify every employee, or only the owner? (Draft: everyone, since anyone can take it.)
- Should closing an urgent report be allowed by the employee who fixed it, or only by the owner? (Draft: owner only.)

## Build order

1. Create the bot and the allow list.
2. Poll and log inbound messages, with the reply "Received #n".
3. Forward to the owner, with owner commands for sending.
4. Close reports, the open list and the morning reminder.

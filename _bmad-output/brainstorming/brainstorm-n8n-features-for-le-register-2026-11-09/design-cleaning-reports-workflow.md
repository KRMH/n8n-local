# Design: cleaning reports and tasks workflow (n8n)

Status: design draft, nothing built. Date: 2026-11-09. Source of requirements: `intent-cleaning-reports.md`.

## 1. What was checked, and what was not

Checked in the n8n docs on 2026-11-09:
- **Data tables** exist and have a Data Table node with row operations Get, Insert, Update, Upsert, Delete, If Row Exists, If Row Does Not Exist. The default size limit is 200 MiB for the whole instance, enough for years of this log. Tables belong to a project.
- **Workflow static data** is documented as experimental, does not persist in test runs, and may misbehave under frequent executions. **Decision: it is not used.** The polling offset and all state live in Data tables.

Not checked (verify during the first build step):
- That Data tables are available in 2.46.6 with your account type, and the available column types. The design uses only text, number, boolean and date.
- Whether the HTTP Request node can use the Telegram credential for `getUpdates`. The Telegram docs page does not say. Fallback in section 9.
- That Telegram's `setWebhook` needs a public HTTPS address. This is from Telegram's Bot API as I know it, not re-read today; it is why the design polls.

## 2. Shape of the solution

Four workflows, one shared sub-workflow, six small tables plus a log.

| Workflow | Trigger | Job |
| --- | --- | --- |
| **W1 Poll and route** | Schedule, every minute | Fetch new Telegram messages, decide, write, reply |
| **W2 Reminders** | Schedule, every 10 minutes | Repeat pings for urgent reports and pending tasks |
| **W3 Morning digest** | Schedule, 08:00 | One summary message to the owner |
| **S1 Send** (sub-workflow) | Called by W1, W2, W3 | Render template, send, log, handle failures |
| **E1 Error handler** | Error Trigger, set as the error workflow of W1-W3 and S1 | Message the owner "Cleaning bot failed: workflow, node, time" |

Pattern for W1: **decide in memory, then apply.** A single Code node reads the incoming messages plus the current open state and returns an ordered list of writes and messages to send. Separate nodes then apply them. This keeps the rules in one testable place and lets two commands arriving in the same minute see each other's effects.

## 3. Tables

All are Data tables in one n8n project. **Decision 2026-11-09: every column is a string.** Numbers and timestamps are stored as text (timestamps as ISO 8601) and converted in the Code nodes. Message templates contain the two characters `\n` for a line break; S1 turns them into real line breaks before sending. Seed files are in `workflows/cleaning/seed/`.

**Decision 2026-11-09 (later): English only, no language setting.** The `messages` table and the `language` row are dropped. All reply texts live in the S1 `Render` Code node (`workflows/cleaning/render.js`), and S1 has four nodes: trigger, `Render`, `Send`, `Log out`. Ignore references below to templates, `messages` and language fallback.

**`people`** (user_id, name, role)
- `role` is `owner` or `employee`; exactly one owner. A person who is not in this table is ignored. (Replaces the earlier `allowlist`. Whether someone has started the bot is learned from a failed send, not stored.)

**`items`** (ref, kind, chalet, text, photo, urgent, status, workers, created_at, last_ping_at, pings)
- One table for reports and tasks. `kind` is `report` or `task`. `ref` is `R17` or `T5`; in commands `#17` means `R17`.
- Reports: `status` is `open` or `closed`; `urgent` is `yes` or empty; `photo` is the Telegram file id; `workers` holds the author's id.
- Tasks: `status` is `pending`, `assigned`, `in_progress` or `done`; `workers` is a comma-separated list of user ids, each written `id` (started) or `id?` (assigned only).
- `pings` counts reminders sent. Timestamps are ISO 8601 text.
- (Replaces the earlier `reports`, `tasks` and `task_workers`.)

**`log`** (ts, update_id, direction, user_id, text, ref)
- `direction` is `in` or `out`; `user_id` is the sender (in) or recipient (out); `ref` is the related `R17` or `T5`, if any.
- Every inbound update and every outbound message gets a row. Rows are never edited or deleted. Photos appear in the text as `[photo <file id>]`.
- Messages from people not in `people` are logged with the sender id and **no text**.

**`state`** (key, value) holds the polling position, the lock and the settings (see the seed file `workflows/cleaning/seed/state.csv`): `telegram_offset`, `poll_lock_until`, `language`, `chalet_count`, `quiet_start`, `quiet_end`, `urgent_repeat_minutes`, `urgent_max_repeats`, `pending_task_minutes`, `digest_time`.

**`messages`** (key, language, text). Every reply and notice the bot sends. Placeholders look like `{chalet}`. If a key is missing for the active language, S1 falls back to `en`.

**Read the rest of this document with these names.** Where later sections say `allowlist` read `people`; `settings` read `state`; `reports`, `tasks` and `task_workers` read `items` (filtered by `kind`, with workers taken from the `workers` cell); and the earlier `unreachable` flag is no longer stored.

Numbers (`#17`, `T5`) are `max(no) + 1`. This is safe because the lock in section 4 allows only one W1 run at a time.

## 4. W1: poll and route

### Nodes in order

1. **Schedule Trigger**, every minute, workflow timezone Europe/Paris.
2. **Lock** (Data Table Get on `state`, then Code): read `poll_lock_until`. If it is in the future, stop silently. Otherwise set it to now + 55 s (Data Table Update). Also set the workflow execution timeout to 50 s. This stops two runs from overlapping, which n8n permits.
3. **Get offset** (Data Table Get `state`).
4. **Fetch updates** (HTTP Request GET): `https://api.telegram.org/bot<TOKEN>/getUpdates?offset=<offset>&timeout=0&limit=100&allowed_updates=["message"]`. If it returns nothing, release the lock and stop.
5. **Load context** (four Data Table Get nodes, merged into one item): `people`, `state`, open `items`.
6. **Decide** (Code, JavaScript): the router. Input: updates plus context. Output:
   - `writes[]`: ordered `{table, op, match, values}` entries.
   - `sends[]`: ordered `{to, key, params, ref_type, ref_no}` entries.
   - `next_offset`: highest `update_id` + 1.
7. **Apply writes**: Split Out, a Switch on table and op, then the Data Table node (Insert or Update).
8. **Send**: Split Out, Execute Workflow S1 once per entry.
9. **Commit**: Data Table Update `telegram_offset` = `next_offset`, and clear `poll_lock_until`.

### Why the offset moves last

If W1 crashes after sending but before step 9, Telegram redelivers the same updates next minute. To avoid doing them twice, step 6 first drops any update whose `update_id` already exists in `log`. The result: each message is handled once, even with retries.

### Which updates are handled

- Only `message` updates in **private chats**. Group chats, edited messages and channel posts are ignored.
- Text messages and photos (the caption is the text; the largest photo size's `file_id` is stored).
- Anything else (voice, sticker, document) gets the reply `unsupported`.

## 5. The router: rules, in order

For each update, in order:

1. **Drop** if its `update_id` is already in `log`.
2. **Identify** the sender in `allowlist`. If unknown or inactive: log `ignored` (id only), no reply, next update.
3. **`/start`**: set `unreachable` false, reply `welcome` (or `welcome_owner`).
4. **Normalise** the text: trim, lower-case for matching, remove a leading `/`.
5. **Match a command** (table below). If it matches, run the handler. Permission failures reply `not_allowed` and write a log row.
6. **Owner reply to a forwarded message**: if the owner message has `reply_to_message` whose text contains `#<n>`, relay to that report's author (`relay`), logged against the report.
7. **Otherwise**:
   - From an **employee**: a new **report** (section 6.1).
   - From the **owner**: reply `owner_help` (no report is created).

### Command grammar

| Who | Pattern (case-insensitive) | Action |
| --- | --- | --- |
| owner | `@<name> <text>`, `@<n> <text>`, `@all <text>` | Message people (6.2) |
| owner | `close #<n>` | Close report |
| owner | `open` | List open reports and tasks |
| anyone | `left <n>` or `clients left <n>` | Create cleaning task |
| anyone | `assign T<k> <name>[, <name>...]` | Hand a task to people |
| anyone | `start T<k>` or `start <n>` | Join a task |
| anyone | `leave T<k>` or `leave <n>` | Leave a task |
| anyone | `finish T<k>` or `finish <n>` | Finish a task (worker or owner) |
| employee | `tasks` | List open tasks |
| anyone | `help` | Command list for the role |

`<n>` is a chalet number from 1 to `chalet_count`. Out of range replies `bad_chalet`.

## 6. Handlers

### 6.1 New report (employee)

- Text starting with `!` or `urgent` sets `priority = urgent`; the marker is stripped.
- Chalet = first match of `chalet <n>` or a leading number in range; otherwise empty.
- Writes: insert `reports` row (`no` next, `status = open`, `pings_sent = 0`), log row.
- Sends: employee gets `report_received` ({no}); owner gets `report_forward` ({no}, {name}, {chalet}, {text}, an urgent flag). An urgent report is forwarded **immediately**, even in quiet hours; only repeats are held back.
- A photo-only message is a valid report (empty text).

### 6.2 Owner messages people

- `@all`: everyone active and not unreachable except the owner.
- `@<name>`: match the first name against `allowlist`, case-insensitive. No match: `unknown_person`. Several matches: `ambiguous_person` with the candidates.
- `@<n>`: everyone with a row in `task_workers` on an open task at chalet `<n>`. None: `nobody_at_chalet`, nothing sent.
- Each recipient gets `from_owner`; the owner gets `delivered` ({count}, {names}). Unreachable recipients are listed in the reply.

### 6.3 Close a report (owner)

- Unknown number: `no_such_report`. Already closed: `already_closed`.
- Else set `status = closed`, `closed_at`, `closed_by`. The author gets `report_closed`, the owner gets `ok`. Pings stop because W2 only looks at open reports.

### 6.4 Tasks

State rules, evaluated on the in-memory state:

| Command | Valid when | Effect | Notifications |
| --- | --- | --- | --- |
| `left <n>` | always | New task `pending` for chalet `<n>` | Owner and all active employees get `task_new`. If chalet `<n>` has other open tasks, the reply to the sender lists them |
| `assign T<k> names` | task open | Add each named person as `assigned` (skip those already on it). Status `assigned` if there were no workers | Each named person gets `task_assigned`; sender gets `ok` |
| `start T<k>` | task open | Add sender as `started` (or upgrade `assigned` to `started`). Status `in_progress` | Other workers and the owner get `task_started` |
| `leave T<k>` | sender is a worker | Remove sender. No workers left: `pending`. Only `assigned` workers left: `assigned`. A `started` worker left: `in_progress` | Others get `task_left` |
| `finish T<k>` | sender is a worker or the owner | `done`, `done_at`, `done_by` | All workers and the owner get `task_done` |

Resolving a chalet number instead of `T<k>`: one open task there selects it. Several open tasks: reply `which_task` listing `T` numbers and statuses. No open task: `no_open_task`.

Errors: unknown task `no_such_task`; closed task `task_closed`; `finish` or `leave` by a non-worker `not_on_task`.

### 6.5 Lists

- `open` (owner): urgent reports first, then normal, then tasks grouped by status. Long lists are split into several messages.
- `tasks` (employee): open tasks only.

## 7. S1: send sub-workflow

Input: `{to, key, params, ref_type, ref_no}`.

1. Read `language` from `settings`; get the template from `messages`; fall back to `en`; fill placeholders.
2. Split text longer than 4096 characters at line breaks.
3. Send with the Telegram node (Send Message), retry up to 3 times with a 2 s wait. A 429 response honours its `retry_after`.
4. On success insert a `log` row (`direction = out`).
5. On a 403: set `allowlist.unreachable = true`, log the failure, and tell the owner `person_unreachable` ({name}). Do not retry.
6. Any other failure after retries: log it and raise, so E1 alerts the owner.

## 8. W2 and W3

### W2 reminders (every 10 minutes)

Skip entirely inside quiet hours (`quiet_start` to `quiet_end`, Europe/Paris), except nothing is lost: the next run after `quiet_end` catches up.

- **Urgent reports:** `status = open`, `priority = urgent`, `pings_sent < urgent_max_repeats`, and `last_ping_at` (or `created_at` when never pinged) older than `urgent_repeat_minutes`. Send `urgent_reminder` to the owner, increment `pings_sent`, set `last_ping_at`, log.
- **Pending tasks:** `status = pending`, older than `pending_task_minutes` since `created_at` or `last_ping_at`, `pings_sent < urgent_max_repeats`. Send `task_pending_reminder` to the owner and update the same way.
- At most one combined message per run, listing everything due, so a bad night does not produce a flood.

### W3 morning digest (08:00)

One `digest` message to the owner: urgent open reports, count of other open reports, tasks by status with chalet numbers. If nothing is open, send `digest_empty`.

## 9. Token handling

- Sending uses a **Telegram credential** (the access token from @BotFather, entered in n8n's credential screen, never in a workflow field or in this repo).
- For `getUpdates`, first try the HTTP Request node with the Telegram credential. If that is not supported, fall back to storing the token in a `secrets` row of `state` and building the URL from it. The token is then in the data tables inside `n8n_data`, as the credentials already are, but not encrypted the same way. Record that trade-off in the spine if you take the fallback.
- Exported workflow JSON never contains credentials, so it can be kept in the public repo. It does contain the table names and rules, which are not sensitive. The data (names, messages) is not exported.

## 10. Edge cases and decisions

| Situation | Behaviour |
| --- | --- |
| Employee not on the allow list writes | Ignored, id logged, no reply |
| Employee never pressed Start | Owner is told on the first failed send; messages to that person are skipped |
| Two employees `start` the same task in one minute | Both become workers; no conflict, because tasks allow several workers |
| Owner closes a report while a ping is queued | The reminder checks status at send time and skips closed reports |
| Telegram is unreachable for a while | `getUpdates` fails, the lock expires, the next run retries. Telegram keeps updates for 24 hours; after a longer outage messages are lost |
| n8n or the PC is off | No messages are processed until it is back (up to 24 hours later). Nothing is lost inside that window |
| A very long message | Split at 4096 characters on send; reports are stored whole |
| Typo such as `strt T5` | Not a command, so from an employee it becomes a report. To reduce this, the router replies `did_you_mean` when the first word is within one edit of a command word, and does not create a report until the sender repeats it |
| Chalet number in a report is wrong | Stored as written; the owner can see it in the forward |
| Timezone change or daylight saving | Quiet hours use the workflow's Europe/Paris clock |

## 11. Test plan

Run each scenario with two real Telegram accounts (owner and one employee) and a third unlisted account.

1. Unlisted account writes: no reply; one `ignored` log row without text.
2. `/start` as employee: welcome.
3. Employee: "chalet 12 heater broken": `#1` received, owner gets the forward.
4. Employee: "! chalet 3 no water": urgent forward at once; leave it open and check W2 pings (shorten `urgent_repeat_minutes` to 2 for the test).
5. Owner replies to the forward: employee receives it.
6. `@maria`, `@12`, `@all` with and without a matching worker.
7. `close #1`, then `close #1` again.
8. `left 12`, then `left 12` again: both created; the second reply lists the first.
9. `assign T1 maria, jean`; `start T1` by Maria; `leave T1`; `finish T1` by a non-worker (refused) then by the owner.
10. `start 12` when chalet 12 has two open tasks: asks which.
11. Stop n8n for 5 minutes while sending messages: after restart all are handled once.
12. Kill W1 mid-run after sending: no duplicate replies on the next run.
13. Block the bot from the employee account: owner is told the person is unreachable.
14. Change `language` to a language with missing keys: falls back to `en`.

## 12. Build order

Each step ends with a check you can see.

1. **Bot and tables.** Create the bot in @BotFather, the n8n credential, the Data tables and the seed rows (owner, employees, settings, English messages). Check: tables visible; the Data Table node reads them; note which column types exist.
2. **S1 Send.** Check: a manual run sends a templated message and writes a `log` row.
3. **W1 skeleton.** Lock, offset, `getUpdates`, log inbound, reply "Received". Settle the token question here. Check: test 1 to 3.
4. **Reports end to end.** Forward, urgent, owner relay, close, `open`. Check: tests 4 to 7.
5. **Tasks.** The five task commands and the lists. Check: tests 8 to 10.
6. **W2 and W3.** Check: urgent and pending pings in the right order, quiet hours respected, the 08:00 digest.
7. **Hardening.** E1 error handler, the restart and crash tests, `did_you_mean`. Check: tests 11 to 14.
8. **Housekeeping.** Export the workflows to the repo (`workflows/` folder), update the spine (Data tables as the state store, polling instead of webhooks, the sub-workflow and error handler), add a README section, run a backup of `n8n_data`.

## 13. Out of scope for the first build

Photos downloaded or shown inline, per-employee language, a web view of the log, task kinds other than cleaning, any link to bookings or Le Register, webhooks and tunnels.

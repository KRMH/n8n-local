> **Superseded 2026-11-09** by `intent-cleaning-reports.md`. This design tied n8n to Le Register and was dropped.

# Design: nightly backup of Le Register (direction A, step 1)

Status: design only, nothing built or changed yet. Date: 2026-11-09.

## What was checked

- Le Register's database is `~/.leregister/leregister.db` (config.py), opened in **WAL mode** (`PRAGMA journal_mode=WAL`, db.py:41). Recent writes sit in `leregister.db-wal` until a checkpoint.
- Consequence: **copying `leregister.db` alone while the bot runs can lose recent bookings or produce a corrupt copy.** The backup must use SQLite's backup API, not a file copy.
- The n8n 2.x image has no `sqlite3` or Python, `Execute Command` is disabled by default, and the file nodes can only read and write files (no delete, no copy). So n8n cannot make the snapshot itself.

## Design: split the job in two

| Part | Where | Job |
| --- | --- | --- |
| **Snapshot** | Windows host, Task Scheduler, 02:00 daily | Consistent copy of the database, integrity check, retention |
| **Monitor** | n8n workflow, 02:30 daily | Confirm a fresh, plausible snapshot exists; alert on Telegram if not |

Splitting keeps the risky part (touching live data) in a tiny script that uses the safe SQLite API, and uses n8n for what it is good at (scheduling, checking, messaging).

### 1. Snapshot script (host)

`backup_leregister.py`, run by Task Scheduler with Le Register's Python (`uv run python`):

1. Open the source read-only: `sqlite3.connect("file:<db path>?mode=ro", uri=True)`.
2. `src.backup(dst)` into `C:\Amaris_Work\n8n-local\backups\leregister\leregister-YYYYMMDD-HHMM.db`. This is safe while the bot is running.
3. Open the copy and run `PRAGMA integrity_check`. If the result is not `ok`, delete the copy and exit non-zero.
4. Retention: keep the last 14 daily files plus one per week for 8 weeks; delete the rest.

### 2. Make the folder visible to n8n

Changes to `docker-compose.yml`:

```yaml
    environment:
      - N8N_RESTRICT_FILE_ACCESS_TO=/files
    volumes:
      - n8n_data:/home/node/.n8n
      - ./backups:/files/backups:ro
```

- Mount **read-only**: n8n only needs to look.
- `N8N_RESTRICT_FILE_ACCESS_TO` limits the file nodes to `/files`.
- Add `backups/` to `.gitignore`. **The database holds client names and phone numbers; the repo is public. Never commit it.**
- The spine's AD-2 says "no bind mounts for n8n state". This mount is not n8n state, but the spine should record it as a new AD (read-only exchange folder).

### 3. n8n workflow "Le Register backup monitor"

1. **Schedule Trigger**: daily 02:30, timezone Europe/Paris.
2. **Read Files from Disk**: selector `/files/backups/leregister/leregister-*.db`.
3. **Code node**:
   - Take the timestamp from each file name, not the file date.
   - Find the newest file and the previous one.
   - Flag a problem if any of these is true: no files, newest older than 26 hours, newest smaller than 8 KB, newest less than 50% of the previous size.
   - Output `{ ok, newest, ageHours, sizeKB, reason }`.
4. **IF** `ok`:
   - **True:** end silently on weekdays; on Sunday send a short "backups healthy" heartbeat.
   - **False:** **Telegram** message: "Le Register backup problem: {reason}".
5. **Error workflow** (set in the workflow's settings): an **Error Trigger** that sends a Telegram message if the monitor itself fails.

Use a **separate Telegram bot** for these alerts, with your chat id. It keeps the owner bot's token out of n8n and avoids any polling conflict.

### 4. Gaps and how they are handled

| Risk | Handling |
| --- | --- |
| PC asleep or off at 02:00 | Task Scheduler: "Run task as soon as possible after a scheduled start is missed" and "Wake the computer". The monitor then alerts on a stale snapshot |
| n8n itself is down, so no alert | The Sunday heartbeat: if it stops arriving, check n8n. A real fix needs an outside watcher (later) |
| Backup on the same disk as the data | Step 1 only protects against corruption and mistakes. Add an offsite copy (OneDrive or Drive node, or a USB folder) as step 2 |
| `n8n_data` (workflows, credentials) not covered | Still manual via the README. A second snapshot of that volume can follow |
| Database moved or renamed | The script reads `LEREGISTER_DB_PATH` if set, else the default |

## Test plan

1. Run the script by hand: a new `.db` appears; open it with `sqlite3` or Python and count rows.
2. Run the workflow manually in n8n: the Code node reports `ok`.
3. Rename the newest file to an old timestamp: the workflow sends the Telegram alert.
4. Restore test: set `LEREGISTER_DB_PATH` to a copy of a snapshot and start the bot against it; check a known booking is there.

## Build order (when approved)

1. Write and test the snapshot script and the Task Scheduler entry.
2. Update `docker-compose.yml`, `.gitignore`, the README and the spine, then `docker compose up -d`.
3. Create the Telegram monitor bot and the n8n credential.
4. Build and test the workflow.

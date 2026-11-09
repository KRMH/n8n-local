# n8n local (Docker)

A light n8n running in one Docker container. The same files work on Windows and Linux Mint.

## Prerequisites

- **Windows:** Docker Desktop, running (check with `docker info`). It needs WSL2 or virtualization enabled. Turn on "Start Docker Desktop when you sign in" so the container restarts after a reboot. On a work machine, confirm your company's Docker Desktop licence, or use an alternative such as Rancher Desktop.
- **Linux Mint:** Docker Engine with the Compose plugin (`docker compose version` must work). Mint is not an officially supported Docker target, so use Docker's Ubuntu repository instructions with the Ubuntu base codename, and add your user to the `docker` group.

## Start

From this folder:

```bash
docker compose up -d
```

Open <http://127.0.0.1:5678> and create the owner account on first visit.

The setup is done when `docker compose ps` shows `n8n` as `healthy` and this returns `{"status":"ok"}`:

```bash
curl http://127.0.0.1:5678/healthz
```

If port 5678 is taken, set `N8N_PORT` in `.env` (see Configuration).

## Everyday commands

| Task | Command |
| --- | --- |
| Stop (data kept) | `docker compose stop` |
| Start again | `docker compose start` |
| See logs | `docker compose logs -f n8n` |
| Check config before starting | `docker compose config` |
| Update n8n | Back up first (see below), change `N8N_VERSION` in `.env`, then `docker compose pull && docker compose up -d` |
| Remove container (data kept) | `docker compose down` |

Updating needs network access. If the pull fails, the running container is unaffected. If a new version misbehaves, set `N8N_VERSION` back to the previous tag and restore the backup.

> Do **not** run `docker compose down -v`. The `-v` flag deletes the data volume, which erases all workflows and credentials. Take a backup first if you are unsure.

## Where the data lives

Everything n8n stores (workflows, credentials, settings, the encryption key, the SQLite database) lives in the Docker named volume `n8n_data`, mounted at `/home/node/.n8n` in the container. It survives restarts, updates and `docker compose down`, and renaming this folder does not affect it.

### Back up

Stop n8n first so the SQLite file is consistent, then copy the whole volume (not only the database; the encryption key lives in it):

```bash
docker compose stop
docker run --rm -v n8n_data:/data -v "${PWD}:/backup" alpine tar czf /backup/n8n-backup.tgz -C /data .
docker compose start
```

This works in Git Bash, PowerShell and Linux shells. It does not work in `cmd.exe`.

### Restore

Stop n8n, then unpack the backup into the volume:

```bash
docker compose stop
docker run --rm -v n8n_data:/data -v "${PWD}:/backup" alpine sh -c "rm -rf /data/* && tar xzf /backup/n8n-backup.tgz -C /data"
docker compose start
```

## Configuration

Optional. Copy `.env.example` to `.env` next to `docker-compose.yml`. `.env` is git-ignored; never commit secrets.

```env
TIMEZONE=Europe/Paris
N8N_VERSION=2.46.6
N8N_PORT=5678
```

- `TIMEZONE`: used for scheduled workflows. **Defaults to `Europe/Paris` if unset, so set your own.**
- `N8N_VERSION`: image tag. Defaults to `2.46.6`, the stable version on 2026-11-09. Change it only when you choose to update.
- `N8N_PORT`: host port. Defaults to `5678`.

## Notes

- n8n is published on `127.0.0.1` only, so it is reachable from this machine and not from your network.
- Settings (image, volume path, timezone variables, file permissions) were checked against the official guide on 2026-11-09: <https://docs.n8n.io/hosting/installation/docker/>. If something fails, compare against that guide.

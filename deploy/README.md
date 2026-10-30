# Self-hosting Vault on the laptop

The hosted Vault is a separate copy of this repo that only ever follows `main`:

```
C:\Satyam\Vault_Project\Vault                 dev checkout (edit here, push to GitHub)
C:\Satyam\Vault_Project\Vault_Host            host clone, updated by the Deploy workflow; never edit by hand
C:\Satyam\Vault_Project\Vault_Host_backups    pg_dump taken before every deploy (last 14 kept)
C:\Satyam\Vault_Project\Vault_Host_data\uploads   uploaded (encrypted) images, a plain folder bind-mounted into the backend
```

The database lives in the `vault_prod_pgdata` Docker volume (Postgres on a Windows bind mount is slow and has permission
problems); the pre-deploy dumps are its file copy.

The hosted stack is the `vault_prod` compose project (`docker-compose.prod.yml`): `db`, `backend`, `web` (nginx serving the
built frontend and proxying `/api/`, `/notes`, `/health` to the backend) and `cloudflared`. Only `web` publishes a port,
`127.0.0.1:47800`. Dev keeps 5173 / 8000 / 5433, so both run at the same time.

| URL | Use |
|---|---|
| `http://localhost:47800` | Hosted Vault on this laptop |
| `https://vault.satyamtank.com` | Hosted Vault from anywhere (Cloudflare Tunnel) |

Vault's encryption needs HTTPS or localhost, so `http://<laptop-ip>:47800` from another device will not work. Use the domain.

## One-time setup

### 1. Host clone and secrets

```powershell
git clone https://github.com/SatyamTank07/Vault C:\Satyam\Vault_Project\Vault_Host
cd C:\Satyam\Vault_Project\Vault_Host
copy .env.prod.sample .env              # set POSTGRES_PASSWORD
copy backend\.env.sample backend\.env   # set a NEW JWT_SECRET and the 2Factor keys
```

`DATABASE_URL` and `FRONTEND_URL` in `backend\.env` are ignored; compose sets them.

Before the first full start, restore the AWS data (see [Restoring data](#restoring-data)). Then open `http://localhost:47800`.

### 2. Cloudflare DNS and Tunnel

1. Cloudflare dashboard → Add a site → `satyamtank.com` (Free plan). Check the imported DNS records and add any that are
   missing (email/MX, other subdomains) before switching.
2. Hostinger → Domains → `satyamtank.com` → Nameservers → set the two Cloudflare nameservers. Wait until Cloudflare
   shows the site as Active.
3. Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel (Cloudflared) → name it `vault-laptop`.
4. Public hostname: `vault.satyamtank.com`, service `HTTP`, URL `web:80`.
5. Copy the tunnel token into `Vault_Host\.env` as `TUNNEL_TOKEN=...` and uncomment `COMPOSE_PROFILES=tunnel`.
6. `docker compose -p vault_prod -f docker-compose.prod.yml up -d` and open `https://vault.satyamtank.com`.

### 3. GitHub Actions self-hosted runner

1. GitHub → Vault → Settings → Actions → Runners → New self-hosted runner → Windows x64. Follow the download/config
   commands, installing it in e.g. `C:\actions-runner` (not inside `Vault_Project`).
2. When `config.cmd` asks for labels, add `vault-host`.
3. Run it as **your Windows user** so it can reach Docker Desktop. Either answer "N" to the service question and start
   `run.cmd` at login (Task Scheduler → At log on), or install the service and set its Log On account to your user.
4. Docker Desktop → Settings → General → "Start Docker Desktop when you sign in".

Every push to `main` (or Actions → Deploy → Run workflow) then backs up the database, resets the host clone to
`origin/main`, rebuilds the stack and waits for `/health`.

### 4. Public repo safety

The repo is public, and a self-hosted runner executes workflow code on this laptop. Settings → Actions → General →
"Fork pull request workflows from outside collaborators" → **Require approval for all outside collaborators**. Never
approve a fork PR's workflow run without reading it.

## Restoring data

The AWS backup is `C:\Satyam\Vault_Project\vault_backup.sql` (plain-SQL `pg_dump`, Postgres 15.17). Restore it into
the empty database **before the backend's first start**: the dump creates the tables itself, and the backend's startup
`create_all` + `run_schema_migrations()` would otherwise create them first and make the restore fail.

```powershell
cd C:\Satyam\Vault_Project\Vault_Host
docker compose -p vault_prod -f docker-compose.prod.yml up -d db
docker compose -p vault_prod -f docker-compose.prod.yml cp ..\vault_backup.sql db:/tmp/restore.sql
docker compose -p vault_prod -f docker-compose.prod.yml exec db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/restore.sql'
docker compose -p vault_prod -f docker-compose.prod.yml up -d --build
```

Check: `docker compose -p vault_prod -f docker-compose.prod.yml exec db psql -U vault_user -d vault_db -c "select count(*) from notes"`
should print 39. Then log in with your existing account and vault secret; notes are restored as ciphertext and unlock as before.

The AWS backup references no uploaded images. For future image restores, copy the files into
`C:\Satyam\Vault_Project\Vault_Host_data\uploads` (same `<user_id>\<note_id>\<file>` layout).

To restore one of the pre-deploy dumps instead, stop the stack, remove the `vault_prod_pgdata` volume, and run the same
steps with that file.

## Day to day

```powershell
cd C:\Satyam\Vault_Project\Vault_Host
docker compose -p vault_prod -f docker-compose.prod.yml ps
docker compose -p vault_prod -f docker-compose.prod.yml logs -f backend
docker compose -p vault_prod -f docker-compose.prod.yml exec db psql -U vault_user -d vault_db
```

The server is unreachable while the laptop sleeps or Docker is stopped; containers restart on their own when Docker starts.

## While the laptop is off

Vault is an installable PWA. Every browser that has opened it keeps:

- the app itself, in a service worker, so `https://vault.satyamtank.com` still opens when Cloudflare would show error 1033;
- an encrypted copy of the user's notes, canvases, schedule and images in IndexedDB (`vault-<user id>`), refreshed
  after every change and on every load. The browser decrypts it with the vault secret, as usual.

While the server is unreachable the header shows **Offline** and Vault keeps working: notes, canvases and the
schedule can be read and changed, and images added. Changes are queued on the device (the `outbox` store) and sent through
`POST /api/sync/push` once the server answers again, then the device pulls a fresh snapshot.

If the same note's text was changed on two devices, the change that syncs last wins and the other version is saved as
a new note titled "… (conflicted copy <date>)" with its own copies of the images. A note deleted on one device but edited on another is kept. If the
session expired meanwhile, the header shows **Sign in to sync**; queued changes stay on the device until you sign in
again as the same user.

A device that has never opened Vault, or a user who never signed in on it, can't use it until the laptop is back.
Logging out deletes the device's copy (Vault warns first if changes haven't synced).

On an iPhone, use Safari's **Add to Home Screen**: Safari may delete a website's storage after 7 days without a visit,
but not an installed app's.

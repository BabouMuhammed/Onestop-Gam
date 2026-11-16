# Hosting a demo on Render

`render.yaml` describes a demo: one free web service that runs the API and serves the web app, and one free PostgreSQL database. It deploys the `main` branch, so every merged pull request is deployed.

This is for showing the system, not for running the shops. On the free plan the service sleeps when idle and takes about a minute to wake, and the free database expires roughly 30 days after it is created. Confirm the current limits on Render's pricing page.

## Steps

1. Sign in to Render and connect the GitHub account that owns this repository.
2. Choose **New**, then **Blueprint**, and pick this repository. Render reads `render.yaml`.
3. When asked, enter `SEED_ADMIN_USERNAME`, `SEED_ADMIN_NAME` and `SEED_ADMIN_PASSWORD` (at least 10 characters). They are stored by Render, never in the repository.
4. Apply. The first deploy builds the app, applies the migrations, creates the two divisions and the administrator, and starts.
5. Open the service's URL and sign in. The administrator has to choose a new password at first sign-in.

## Loading the opening stock

The stock files are not in the repository. From a computer that has them in `data/opening-stock/`, point the import at the hosted database for one command, using the **External Database URL** from the database's page on Render:

```
# PowerShell
$env:DATABASE_URL = "<External Database URL>"; npm run import:opening-stock; Remove-Item Env:DATABASE_URL
```

The import refuses to run twice for a division that already has products.

## Moving from demo to real use

- Put the service and the database on paid plans, so the app stays awake and the database is kept and backed up.
- Schedule `tools/backup.sh` (see [BACKUP.md](BACKUP.md)) or turn on the host's own backups, and keep a copy elsewhere.
- Start from an empty database and import the real opening stock, rather than carrying demo sales and placeholder prices across.
- Make the repository private if business data or deployment details will ever be committed.

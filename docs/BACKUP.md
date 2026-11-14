# Backup and restore

The database holds every stock movement, price and audit record. Losing it means recounting both shops.

## What is backed up

`tools/backup.sh` writes one compressed PostgreSQL dump per run to `BACKUP_DIR`, checks that the dump is readable, and deletes dumps older than `BACKUP_KEEP_DAYS` (30 by default). Dump files are created readable only by the user that runs the script.

## Schedule it

On the server that runs PostgreSQL, as a user that can read the database:

```
# crontab -e    (every day at 01:30)
30 1 * * * DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/onestop BACKUP_DIR=/var/backups/onestop /opt/onestop/tools/backup.sh >> /var/log/onestop-backup.log 2>&1
```

Then copy `BACKUP_DIR` to a second place that is not the same machine: another computer, an external drive taken off site, or cloud storage. A backup on the same disk as the database does not survive a disk failure, theft or fire. Dumps contain password hashes and business data, so encrypt them before they leave the server.

Check the log weekly. A backup that silently stopped is the usual way data is lost.

## Restore

Restore into a **new, empty** database first, never over the live one.

```
createdb onestop_restore
pg_restore --no-owner --no-privileges --exit-on-error --dbname postgresql://USER:PASSWORD@localhost:5432/onestop_restore /var/backups/onestop/onestop-YYYYMMDDTHHMMSSZ.dump
```

Check the restored copy:

```
psql onestop_restore -c 'SELECT count(*) FROM "Product"' -c 'SELECT max("createdAt") FROM "StockMovement"'
```

If the numbers are what you expect, stop the API, point `DATABASE_URL` at the restored database (or rename the databases), and start the API again. Everything recorded after the dump was taken is missing and has to be entered again from paper records.

## Practise it

Run a restore into a scratch database once a month and after every upgrade. This procedure was run end to end on PostgreSQL 16 when it was written: dump, restore into an empty database, and compare row counts.

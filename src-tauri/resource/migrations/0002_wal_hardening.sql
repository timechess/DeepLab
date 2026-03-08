-- Keep WAL mode explicit and set a conservative auto-checkpoint target.
-- journal_mode is persistent per database; wal_autocheckpoint is per-connection.
PRAGMA journal_mode = WAL;
PRAGMA wal_autocheckpoint = 200;

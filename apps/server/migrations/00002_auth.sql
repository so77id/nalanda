-- The professor auth schema (#150, ADR-0009): who may log in, which Google
-- account proves it, and which browsers are currently holding a session.
--
-- Numbered 00002 although 00001 is deleted in this same commit, and that is not
-- an oversight. goose keys applied migrations by VERSION: every checkout that
-- ran the server after #149 has version 1 recorded, so a file reusing that
-- number would be considered already applied and this schema would never arrive.
-- The upgrade path is covered by
-- storage_test.TestTheAuthMigrationAppliesOverADatabaseThatRanThePlaceholder.
--
-- Times are unix seconds in INTEGER columns, which is what SQLite's unixepoch()
-- returns and what the Go side scans into time.Time.

-- +goose Up

-- Every row here is a professor (ADR-0009): students never get accounts, they
-- read publicly and join a session with a code. The table is called `users`
-- rather than `professors` because the day a second role exists it is this table
-- that grows a column, not a second table that duplicates the login path.
CREATE TABLE users (
    -- AUTOINCREMENT, so a deleted professor's id is never handed to the next
    -- one. Without it SQLite reuses the highest free rowid, and an id that
    -- silently changes owner is the kind of thing nobody tests for.
    user_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    -- COLLATE NOCASE because Google returns the address as the account holder
    -- typed it: without it "Profesora@…" and "profesora@…" are two professors,
    -- and only one of them can ever be found by the login resolver. The folding
    -- is ASCII-only, which is the whole of the local-part syntax in practice.
    email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    name           TEXT    NOT NULL DEFAULT '',
    -- The gate the session middleware reads on every request. The screen that
    -- flips it is WP-C3 (#151); the column is here because the middleware that
    -- honours it ships in this WP.
    is_active      INTEGER NOT NULL DEFAULT 1,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    deactivated_at INTEGER
);

-- The stable login key is (provider, subject), never the email: Google lets an
-- account holder change their address, and an email-keyed login would either
-- lock them out or, worse, hand their account to whoever inherits the address.
-- Email is kept as metadata, for showing a human who this row belongs to.
CREATE TABLE oauth_identities (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    provider  TEXT    NOT NULL,
    subject   TEXT    NOT NULL,
    email     TEXT    NOT NULL,
    linked_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (provider, subject)
);
CREATE INDEX idx_oauth_identities_user ON oauth_identities(user_id);

-- Sessions are server-side: the cookie carries an opaque random token and this
-- table holds its sha256, so a leak of the database does not hand anyone a
-- usable cookie. Expiry is the row's, which is why a restart of the process logs
-- nobody out and why revoking a session is a DELETE rather than a wait.
--
-- Named user_sessions rather than sessions on purpose: ADR-0008 puts LIVE class
-- sessions on this server, and one of the two would have had to be renamed later
-- in a schema where migrations are never edited.
CREATE TABLE user_sessions (
    token_hash   TEXT    PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    -- Per session, not per form: a token stored beside the session is one the
    -- server can verify without keeping any state of its own.
    csrf_token   TEXT    NOT NULL,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
    user_agent   TEXT    NOT NULL DEFAULT '',
    ip_address   TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX idx_user_sessions_user    ON user_sessions(user_id);
-- Sweeping expired sessions is a range scan over this column.
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);

-- +goose Down

-- Documentation of the inverse, never executed: ADR-0034 §Consequences records
-- that rolling a binary back over an applied migration is not supported, so this
-- block is unreachable by design and untested by construction
-- (backend-code-style.md §Adding a migration, rule 2).
DROP TABLE user_sessions;
DROP TABLE oauth_identities;
DROP TABLE users;

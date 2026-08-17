# Targets a human runs by hand. The protocols live in
# docs/standards/testing-strategy.md and are NOT duplicated here — one home per
# fact, and a Makefile copy of a battery is a copy that drifts.
#
# This file exists for one reason: documentation.md requires that a manual
# verification procedure state its steps in prose and its SETUP as a target the
# reader runs. GOOGLE-CHECK.md is that procedure, and its setup was a third prose
# copy of the run command until #150's review said so (DCO-7). The worked case is
# apps/amc-worker's `make paper`, whose prose command list was wrong twice.

.PHONY: login-check run

# Setup for GOOGLE-CHECK.md: a clean database and the server running with your
# real .env. Everything after this is a human with a browser.
#
# The database is REMOVED first, deliberately: the bootstrap only adopts a
# server with no professors at all, so a leftover file from an earlier run makes
# step 3 fail for the right reason and look like a bug.
login-check: reset run

# Run against .env WITHOUT touching the database. This is the target step 4 of
# GOOGLE-CHECK.md uses to restart the process, and keeping it separate is not
# tidiness: that step exists to prove a session survives a restart, and a restart
# that wiped the database would prove the opposite while looking green.
run:
	@test -f .env || { \
		echo "apps/server/.env is missing — copy .env.example and fill in the OAuth client (GOOGLE-CHECK.md §2)"; \
		exit 1; \
	}
	set -a && . ./.env && set +a && go run ./cmd/server

.PHONY: reset

# Discard the local database. The bootstrap only adopts a server with no
# professors at all, so a leftover file makes GOOGLE-CHECK step 3 fail for the
# right reason and look like a bug.
# It sources .env like `run` does, so the path has ONE home: NALANDA_DATABASE_URL
# is configuration, and a hardcoded nalanda.db here would leave the real database
# in place — the exact failure this target exists to prevent (#150 review,
# ARQ-16).
reset:
	@test -f .env || { \
		echo "apps/server/.env is missing — copy .env.example and fill in the OAuth client (GOOGLE-CHECK.md §2)"; \
		exit 1; \
	}
	set -a && . ./.env && set +a && rm -f "$${NALANDA_DATABASE_URL}" "$${NALANDA_DATABASE_URL}-wal" "$${NALANDA_DATABASE_URL}-shm"

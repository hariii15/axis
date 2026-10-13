"""Seed upeg.requisition_deails with synthetic rows for cache hit/miss demos.

Why this exists: with only a handful of rows every query answers in ~2 ms,
so a cache MISS looks as fast as a cache HIT. With 6000+ rows the MISS has
to scan/aggregate thousands of rows in Postgres (slow) while the HIT is
served from memory (fast) -- the difference becomes obvious in
GET /cache/stats (misses vs hits) and in response times.

Usage:
    pip install psycopg2-binary
    python seed_6000.py                 # add 6000 rows (default)
    python seed_6000.py --count 10000   # add 10000 rows instead
    python seed_6000.py --check         # only show current row count

Notes:
    * Connection comes from DATABASE_URL (env var or .env file).
    * Only touches columns that exist in the table:
      requisition_id, department_name, status, created_by, amount,
      created_date. (The model also names `business_unit`, but that column
      does not exist in the database, so it is left out.)
    * Idempotent: uses ON CONFLICT (requisition_id) DO NOTHING, and IDs are
      deterministic (LOAD-000001 ...), so re-running is safe.
"""

from __future__ import annotations

import argparse
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone

TABLE = "upeg.requisition_deails"

DEPARTMENTS = [
    "Chemical", "Finance", "TBWES", "IT", "HR",
    "Sales", "Engineering", "Support", "Marketing", "Operations",
]
# status 1 = pending (most common), 2/3 = other states
STATUSES = [1, 1, 1, 2, 2, 3]


def load_dotenv(path: str = ".env") -> None:
    """Minimal .env loader (KEY=VALUE lines); never overwrites real env vars."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip().strip("'\"")
            os.environ.setdefault(key, value)


def get_conn():
    try:
        import psycopg2
    except ImportError:
        sys.exit("psycopg2 is not installed. Run:  python -m pip install psycopg2-binary")
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        sys.exit("DATABASE_URL is not set (env var or .env file).")
    return psycopg2.connect(db_url)


def table_count(conn) -> int:
    with conn.cursor() as cur:
        cur.execute(f"SELECT count(*) FROM {TABLE}")
        return cur.fetchone()[0]


def make_rows(count: int, prefix: str, start: int = 1) -> list[tuple]:
    rng = random.Random(42)  # deterministic -> re-runnable
    base = datetime.now(timezone.utc) - timedelta(days=365)
    rows = []
    for i in range(start, start + count):
        req_id = f"{prefix}-{i:06d}"
        rows.append(
            (
                req_id,
                rng.choice(DEPARTMENTS),
                rng.choice(STATUSES),
                f"user{rng.randint(1, 200)}@example.com",
                round(rng.uniform(1000, 100_000), 2),
                base + timedelta(
                    days=rng.randint(0, 365),
                    hours=rng.randint(0, 23),
                    minutes=rng.randint(0, 59),
                ),
            )
        )
    return rows


def seed(count: int, batch_size: int, prefix: str) -> None:
    conn = get_conn()
    try:
        before = table_count(conn)
        print(f"rows before: {before}")

        rows = make_rows(count, prefix)
        sql = (
            f"INSERT INTO {TABLE} "
            "(requisition_id, department_name, status, created_by, amount, created_date) "
            "VALUES (%s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (requisition_id) DO NOTHING"
        )
        inserted = 0
        t0 = time.perf_counter()
        with conn.cursor() as cur:
            for j in range(0, len(rows), batch_size):
                cur.executemany(sql, rows[j : j + batch_size])
                inserted += cur.rowcount
                print(f"  ... batch {j // batch_size + 1}: +{cur.rowcount} rows", flush=True)
        conn.commit()
        dt = time.perf_counter() - t0

        after = table_count(conn)
        print(f"inserted: {inserted} new rows in {dt:.1f}s")
        print(f"rows after:  {after}")
    finally:
        conn.close()

    print()
    print("Done. Now compare MISS vs HIT (server must be running):")
    print("  1. Cold query (MISS, hits Postgres):")
    print('     Invoke-RestMethod -Method Post http://localhost:3000/query -ContentType "application/json"')
    print('       -Body \'{"model":"PurchaseRequisitions","axes":["department"],"metrics":["newCount"]}\'')
    print("  2. GET http://localhost:3000/cache/stats   -> misses: 1")
    print("  3. Repeat query #1 (HIT, no SQL) and watch it return instantly.")
    print("  4. GET http://localhost:3000/cache/stats   -> hits: 1")
    print("  5. GET http://localhost:3000/cache/entries -> see the cached rows.")


def main() -> None:
    load_dotenv()
    ap = argparse.ArgumentParser(description="Seed requisition rows for cache demos.")
    ap.add_argument("--count", type=int, default=7000, help="rows to add (default 6000)")
    ap.add_argument("--batch-size", type=int, default=1000, help="rows per batch")
    ap.add_argument("--prefix", default="LOAD", help="ID prefix (default LOAD)")
    ap.add_argument("--check", action="store_true", help="only show row count, insert nothing")
    args = ap.parse_args()

    if args.check:
        conn = get_conn()
        try:
            print(f"rows in {TABLE}: {table_count(conn)}")
        finally:
            conn.close()
        return

    if args.count < 1:
        sys.exit("--count must be >= 1")
    seed(args.count, args.batch_size, args.prefix)


if __name__ == "__main__":
    main()

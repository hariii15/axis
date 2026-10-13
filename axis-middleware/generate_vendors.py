#!/usr/bin/env python3
"""
Generate 1000 vendor records matching the existing company tables.

Mirrors the distributions and formats of the current 30 rows
(VEN0001-VEN0030, from company_details_test_data.xlsx):
  - company_id: VEN%04d
  - PAN: 5 letters + 4 digits + 1 letter
  - GST: 2-digit state code + PAN + entity digit + 'Z' + checksum digit
  - CIN: U + 5 digits + state + year + PTC + 6 digits
  - turnover bands by classification: Micro ~16-21M, Small ~54-107M,
    Medium ~160-209M (2 decimals)
  - contacts: Indian first/last names, 98765xxxxx phones,
    firstname.lastname@companydomain.example emails

Usage:
    python generate_vendors.py                  # VEN0001-VEN1000
    python generate_vendors.py -o out.sql --seed 7
    python generate_vendors.py --start 1001 --count 4000 -o add.sql --seed 7

Run it with:
    psql "$DATABASE_URL" -f vendor_seed_1000.sql

INSERTs use ON CONFLICT (company_id) DO NOTHING, so the existing 30 rows
are preserved and the tables land on exactly 1000 companies.
"""

from __future__ import annotations

import argparse
import random
import string

FIRST = [
    "Aarav", "Vihaan", "Arjun", "Sai", "Reyansh", "Krishna", "Ishaan",
    "Rohan", "Kabir", "Ananya", "Diya", "Aadhya", "Priya", "Neha",
    "Kavya", "Meera", "Divya", "Pooja", "Sneha", "Rahul", "Vikram",
    "Sanjay", "Manoj", "Nitin", "Rakesh", "Suresh", "Amit", "Karan",
    "Deepa", "Lakshmi", "Swetha", "Monica", "Ishita", "Anand",
    "Harish", "Karthik", "Aditya", "Mihir", "Chirag", "Thomas",
]
LAST = [
    "Sharma", "Verma", "Patel", "Mehta", "Shah", "Iyer", "Rao",
    "Reddy", "Nair", "Menon", "Gupta", "Singh", "Yadav", "Joshi",
    "Kulkarni", "Deshmukh", "Pawar", "Reddy", "Chopra", "Malhotra",
    "Kapoor", "Khanna", "Bose", "Sen", "Das", "Mukherjee", "Pillai",
    "Krishnan", "Gowda", "Shetty", "Khan", "Sheikh", "Agarwal",
    "Jain", "Bansal", "Mittal", " Saxena".strip(), "Pandey", "Tiwari",
    "Mishra", "Dubey", "Chauhan", "Rathore", "Chowdhury", "Dutta",
]

NAME_A = [
    "Apex", "BluePeak", "Crescent", "Delta", "Evergreen", "Fusion",
    "GreenField", "Horizon", "Indus", "Jupiter", "Kaveri", "Lotus",
    "Metro", "Nova", "Orbit", "Prime", "Quantum", "RiverStone",
    "Skyline", "Trident", "Unity", "Vertex", "WestWind", "Xcel",
    "Yashika", "Zenith", "Aster", "BrightLine", "CoreLink", "Dynamic",
    "SilverLine", "GoldPeak", "Rapid", "True", "Mega", "Ultra",
    "Super", "Grand", "Royal", "National", "Bharat", "Shakti",
    "Vijay", "Surya", "Chandra", "Agni", "Varun", "Kuber",
]
NAME_B = [
    "Industrial", "Technologies", "Office", "Engineering", "Facility",
    "Electrical", "Packaging", "Safety", "Mechanical", "IT",
    "Hardware", "Logistics", "CleanTech", "Network", "Precision",
    "Water", "HVAC", "Software", "Solar", "Transport", "Automation",
    "Technical", "Medical", "Data", "Construction", "Telecom",
    "Process", "Systems", "Services", "Supplies", "Solutions",
]
NAME_C = [
    "Pvt Ltd", "Solutions", "Services", "Industries", "Systems",
    "Enterprises", "Works", "Supplies", "Equipment", "Components",
]

SECTORS = ["Supplies", "Services", "Systems", "Industries", "Solutions", "Works"]

STATES = ["KA", "TN", "MH", "GJ", "KL", "TS", "AP", "DL", "WB", "RJ"]
STATE_CODES = {
    "KA": "29", "TN": "33", "MH": "27", "GJ": "24", "KL": "32",
    "TS": "36", "AP": "37", "DL": "07", "WB": "19", "RJ": "08",
}

MSME_TYPES = ["Proprietorship", "Partnership", "Private Limited"]

# (classification, msme Yes/No, turnover low, turnover high)
CLASS_BANDS = [
    ("Micro", "Yes", 16_000_000, 21_500_000, 0.27),
    ("Small", "Yes", 54_000_000, 107_000_000, 0.50),
    ("Medium", "No", 160_000_000, 210_000_000, 0.23),
]


def pick_classification(rng: random.Random) -> tuple[str, str, int, int]:
    r = rng.random()
    acc = 0.0
    for cls, msme, lo, hi, w in CLASS_BANDS:
        acc += w
        if r <= acc:
            return cls, msme, lo, hi
    cls, msme, lo, hi, _ = CLASS_BANDS[-1]
    return cls, msme, lo, hi


def rand_pan(rng: random.Random) -> str:
    return (
        "".join(rng.choice(string.ascii_uppercase) for _ in range(5))
        + "".join(rng.choice(string.digits) for _ in range(4))
        + rng.choice(string.ascii_uppercase)
    )


def rand_company(rng: random.Random, used: set[str]) -> str:
    while True:
        name = f"{rng.choice(NAME_A)} {rng.choice(NAME_B)} {rng.choice(NAME_C)}"
        name = " ".join(name.split())
        if name not in used:
            used.add(name)
            return name


def domain_of(company: str) -> str:
    alnum = "".join(ch for ch in company.lower() if ch.isalnum())
    return f"{alnum[:24] or 'company'}.example"


def sql_str(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--output", default="vendor_seed_1000.sql")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--start", type=int, default=1,
                    help="first company number (e.g. 1001 to append after VEN1000)")
    ap.add_argument("--count", type=int, default=1000,
                    help="how many companies to generate")
    args = ap.parse_args()
    if args.start < 1 or args.count < 1 or args.start + args.count - 1 > 9999:
        ap.error("--start >= 1, --count >= 1, and last id must stay VEN9999")
    rng = random.Random(args.seed)
    total = args.count

    used_names: set[str] = set()
    ci, fi, cd = [], [], []
    for n in range(args.start, args.start + total):
        cid = f"VEN{n:04d}"
        company = rand_company(rng, used_names)
        pan = rand_pan(rng)
        state = rng.choice(STATES)
        gst = f"{STATE_CODES[state]}{pan}1Z{rng.choice(string.digits)}"
        cls, msme, lo, hi = pick_classification(rng)
        msme_type = rng.choice(MSME_TYPES)
        cin = (
            f"U{rng.randint(10000, 99999)}{state}"
            f"{rng.randint(2016, 2023)}PTC{rng.randint(100001, 199999)}"
        )
        t23 = round(rng.uniform(lo, hi), 2)
        t24 = round(rng.uniform(lo, hi), 2)
        t25 = round(rng.uniform(lo, hi), 2)
        first = rng.choice(FIRST)
        last = rng.choice(LAST)
        phone = f"98765{rng.randint(10000, 99999):05d}"
        email = f"{first.lower()}.{last.lower()}@{domain_of(company)}"

        ci.append(
            f"({sql_str(cid)}, {sql_str(company)}, {sql_str(pan)}, "
            f"{sql_str(gst)}, {sql_str(msme)}, {sql_str(msme_type)}, "
            f"{sql_str(cls)}, {sql_str(cin)})"
        )
        fi.append(f"({sql_str(cid)}, {t23:.2f}, {t24:.2f}, {t25:.2f})")
        cd.append(
            f"({sql_str(cid)}, {sql_str(f'{first} {last}')}, "
            f"{sql_str(phone)}, {sql_str(email)})"
        )

    ddl = """BEGIN;

CREATE TABLE IF NOT EXISTS company_info (
    company_id VARCHAR(20) PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    pan VARCHAR(20),
    gst VARCHAR(30),
    msme VARCHAR(10),
    msme_type VARCHAR(50),
    msme_classification VARCHAR(50),
    cin VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS financial_info (
    company_id VARCHAR(20) PRIMARY KEY,
    turnover_2023_24 NUMERIC(18,2),
    turnover_2024_25 NUMERIC(18,2),
    turnover_2025_26 NUMERIC(18,2),
    CONSTRAINT fk_financial_company FOREIGN KEY (company_id)
        REFERENCES company_info(company_id)
);

CREATE TABLE IF NOT EXISTS contact_details (
    company_id VARCHAR(20) PRIMARY KEY,
    contact_name VARCHAR(150),
    contact_number VARCHAR(30),
    email_id VARCHAR(255),
    CONSTRAINT fk_contact_company FOREIGN KEY (company_id)
        REFERENCES company_info(company_id)
);
"""

    def bulk(table: str, cols: str, rows: list[str]) -> str:
        vals = ",\n".join(rows)
        return (
            f"INSERT INTO {table} ({cols}) VALUES\n{vals}\n"
            f"ON CONFLICT (company_id) DO NOTHING;\n"
        )

    out = (
        ddl
        + "\n"
        + bulk(
            "company_info",
            "company_id, company_name, pan, gst, msme, msme_type, msme_classification, cin",
            ci,
        )
        + "\n"
        + bulk(
            "financial_info",
            "company_id, turnover_2023_24, turnover_2024_25, turnover_2025_26",
            fi,
        )
        + "\n"
        + bulk(
            "contact_details",
            "company_id, contact_name, contact_number, email_id",
            cd,
        )
        + "\nCOMMIT;\n"
    )
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"wrote {args.output}: VEN{args.start:04d}-VEN{args.start + total - 1:04d} ({total} companies)")


if __name__ == "__main__":
    main()

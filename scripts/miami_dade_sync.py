#!/usr/bin/env python3
"""
Miami-Dade County Clerk — Bulk Data Sync Pipeline
===================================================

Uses the Miami-Dade Official Records Developer APIs:
  BASE: https://www2.miamidadeclerk.gov/Developers/

Step 1 — FTPapi: list available bulk files in a folder
  GET api/FTPapi?folderName={folder}&AuthKey={AUTH_KEY}
  → JSON: { "Files": ["20240524.txt", ...], "Folders": [...] }

Step 2 — FTPapi: download the file for the target date
  GET api/FTPapi?folderName={folder}&fileName={file}&AuthKey={AUTH_KEY}
  → raw text (pipe-delimited) or zip content

Step 3 — Parse: filter for LIS PENDENS doc types locally

Step 4 — Enrich (optional): OfficialRecords API for each CFN/folio
  GET api/OfficialRecords?cfn={cfn}&AuthKey={AUTH_KEY}
  → JSON with party names, folio, legal description, consideration
  ⚠ $0.20/unit — script halts if UnitsBalance ≤ 5

Step 5 — Push to Supabase scraper_leads table

Usage:
  python scripts/miami_dade_sync.py [--days 7] [--no-enrich] [--dry-run]

Required env vars:
  MD_CLERK_AUTH_KEY          Miami-Dade developer API key
  NEXT_PUBLIC_SUPABASE_URL   Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY  Supabase service role key (server-side only)

Optional env vars:
  MD_FTPAPI_FOLDER   Folder name in the FTPapi (default: OfficialRecords)
  MD_LOOKBACK_DAYS   Number of days to look back (default: 7)
"""

import argparse
import csv
import io
import json
import logging
import os
import sys
import time
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import requests
from supabase import create_client, Client

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("miami-dade-sync")

# ─── Constants ────────────────────────────────────────────────────────────────

BASE_URL     = "https://www2.miamidadeclerk.gov/Developers/"
FTPAPI_URL   = f"{BASE_URL}api/FTPapi"
OR_API_URL   = f"{BASE_URL}api/OfficialRecords"

# Minimum unit balance before we halt enrichment calls
UNITS_HALT_THRESHOLD = 5

# Exponential backoff: initial wait in seconds, max attempts
BACKOFF_BASE    = 2.0
BACKOFF_MAX_SEC = 120
MAX_RETRIES     = 6

# Request timeout (seconds)
REQUEST_TIMEOUT = 30

# Lis Pendens doc type variants in Miami-Dade bulk files
LP_DOC_TYPES = {
    "lis pendens", "lispendens", "lis-pendens", "lp",
    "lis pendens residential", "lis pendens commercial",
    "lis pendens - residential", "lis pendens - commercial",
}

# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_env(key: str, required: bool = True) -> str:
    val = os.environ.get(key, "").strip()
    if required and not val:
        log.error(f"Required environment variable {key!r} is not set.")
        sys.exit(1)
    return val


def backoff_get(url: str, params: dict, session: requests.Session) -> requests.Response:
    """GET with exponential backoff on 429 / 5xx errors."""
    wait = BACKOFF_BASE
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            res = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
            if res.status_code == 429:
                retry_after = float(res.headers.get("Retry-After", wait))
                log.warning(f"Rate limited. Waiting {retry_after:.0f}s (attempt {attempt}/{MAX_RETRIES})")
                time.sleep(retry_after)
                wait = min(wait * 2, BACKOFF_MAX_SEC)
                continue
            if res.status_code >= 500:
                log.warning(f"Server error {res.status_code}. Retrying in {wait:.0f}s (attempt {attempt}/{MAX_RETRIES})")
                time.sleep(wait)
                wait = min(wait * 2, BACKOFF_MAX_SEC)
                continue
            return res
        except requests.RequestException as exc:
            if attempt == MAX_RETRIES:
                raise
            log.warning(f"Request error: {exc}. Retrying in {wait:.0f}s")
            time.sleep(wait)
            wait = min(wait * 2, BACKOFF_MAX_SEC)
    raise RuntimeError(f"Max retries exceeded for {url}")


def parse_date(val: str) -> Optional[str]:
    """Parse various date formats → YYYY-MM-DD, or None."""
    if not val:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%Y%m%d", "%m-%d-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(val.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_money(val: str) -> float:
    """Parse '$1,234.56' or '1234.56' → float."""
    if not val:
        return 0.0
    try:
        return float(val.replace("$", "").replace(",", "").strip())
    except ValueError:
        return 0.0


# ─── FTPapi ───────────────────────────────────────────────────────────────────

def list_ftpapi_files(folder: str, auth_key: str, session: requests.Session) -> list[str]:
    """
    List files available in the given folder via FTPapi.
    Uses folderListName parameter (confirmed from live API inspection).
    Response: { "IPAddress": "...", "Status": "Success"|"Failed",
                "StatusDesc": "...", "UnitsBalance": N, "Files": [...] }
    """
    log.info(f"FTPapi: listing files in folder '{folder}'")
    res = backoff_get(FTPAPI_URL, {"folderListName": folder, "AuthKey": auth_key}, session)

    try:
        data = res.json()
    except (json.JSONDecodeError, ValueError):
        # Plain newline-separated list fallback
        lines = [l.strip() for l in res.text.splitlines() if l.strip()]
        log.info(f"FTPapi: {len(lines)} files (plain text response)")
        return lines

    # Check for API-level errors
    status = data.get("Status", "")
    status_desc = data.get("StatusDesc", "")
    units = data.get("UnitsBalance")

    if units is not None:
        log.info(f"FTPapi UnitsBalance: {units}")

    if status == "Failed":
        if "IP Not Authorized" in status_desc:
            log.error(
                f"FTPapi: IP Not Authorized — your IP ({data.get('IPAddress')}) is not whitelisted.\n"
                "  Fix: log in to https://www2.miamidadeclerk.gov/Developers/ → Account Settings\n"
                "  → Authorized IP Addresses → add your current IP, then re-run."
            )
        else:
            log.error(f"FTPapi: {status_desc}")
        return []

    if not res.ok:
        log.error(f"FTPapi list failed: {res.status_code} {res.text[:300]}")
        return []

    files = (
        data.get("Files") or data.get("files") or
        data.get("FileList") or data.get("fileList") or []
    )
    log.info(f"FTPapi: {len(files)} files available in '{folder}'")
    return [str(f) for f in files]


def download_ftpapi_file(folder: str, filename: str, auth_key: str, session: requests.Session) -> str:
    """Download a specific file and return its text content."""
    log.info(f"FTPapi: downloading '{filename}' from '{folder}'")
    res = backoff_get(FTPAPI_URL, {"folderName": folder, "fileName": filename, "AuthKey": auth_key}, session)

    if not res.ok:
        raise RuntimeError(f"FTPapi download failed for {filename}: {res.status_code} {res.text[:200]}")

    # Handle zip files
    if filename.lower().endswith(".zip") or res.headers.get("Content-Type", "").startswith("application/zip"):
        with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
            # Extract the first text file found
            txt_files = [n for n in zf.namelist() if n.lower().endswith((".txt", ".csv", ".pipe", ".dat"))]
            if not txt_files:
                txt_files = zf.namelist()
            log.info(f"FTPapi: unzipped — extracting '{txt_files[0]}'")
            return zf.read(txt_files[0]).decode("utf-8", errors="replace")

    return res.content.decode("utf-8", errors="replace")


def pick_target_files(available: list[str], lookback_days: int) -> list[str]:
    """
    Select files whose names contain dates within the lookback window.
    Miami-Dade bulk files are typically named like: 20240524.txt or 2024-05-24.txt
    Falls back to picking the most recent N files if date parsing fails.
    """
    today = datetime.now(tz=timezone.utc).date()
    cutoff = today - timedelta(days=lookback_days)

    dated: list[tuple[datetime, str]] = []
    undated: list[str] = []

    for fname in available:
        # Extract 8-digit date from filename
        import re
        m = re.search(r"(\d{4})[-_]?(\d{2})[-_]?(\d{2})", fname)
        if m:
            try:
                fdate = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3))).date()
                if cutoff <= fdate <= today:
                    dated.append((fdate, fname))
            except ValueError:
                undated.append(fname)
        else:
            undated.append(fname)

    if dated:
        dated.sort(reverse=True)
        chosen = [f for _, f in dated]
        log.info(f"Picked {len(chosen)} dated file(s): {chosen}")
        return chosen

    # No dates found — take the last N files (alphabetically last = most recent)
    fallback = sorted(available)[-min(lookback_days, len(available)):]
    log.info(f"No date-named files found — taking last {len(fallback)} file(s): {fallback}")
    return fallback


# ─── Bulk File Parser ─────────────────────────────────────────────────────────

# Column name aliases → canonical field key
COL_ALIASES: dict[str, str] = {
    # Instrument / CFN
    "cfn": "cfn", "control_file_number": "cfn", "instr_num": "cfn",
    "instrnum": "cfn", "instrument_number": "cfn", "instrumentnumber": "cfn",
    "cfn_number": "cfn", "film_code": "cfn",

    # Recording date
    "record_date": "record_date", "recording_date": "record_date",
    "rec_date": "record_date", "recorded_date": "record_date",
    "filed_date": "record_date", "file_date": "record_date",
    "date_recorded": "record_date",

    # Document type
    "doc_type": "doc_type", "document_type": "doc_type",
    "instr_type": "doc_type", "instrument_type": "doc_type",
    "type": "doc_type", "doctype": "doc_type",

    # Grantor (mortgagor / defendant)
    "grantor_name_1": "grantor_1", "grantor_name1": "grantor_1",
    "grantor1": "grantor_1", "grantor_1": "grantor_1", "grantor": "grantor_1",
    "grantor_name": "grantor_1",

    "grantor_name_2": "grantor_2", "grantor_name2": "grantor_2",
    "grantor2": "grantor_2", "grantor_2": "grantor_2",

    # Grantee (lender / plaintiff)
    "grantee_name_1": "grantee_1", "grantee_name1": "grantee_1",
    "grantee1": "grantee_1", "grantee_1": "grantee_1", "grantee": "grantee_1",
    "grantee_name": "grantee_1",

    "grantee_name_2": "grantee_2", "grantee_name2": "grantee_2",
    "grantee2": "grantee_2", "grantee_2": "grantee_2",

    # Amount
    "consideration": "amount", "amount": "amount",
    "mortgage_amount": "amount", "loan_amount": "amount",

    # Folio
    "folio_num": "folio", "folio_number": "folio", "folio": "folio",
    "parcel_id": "folio", "parcel_no": "folio", "pcn": "folio",

    # Legal description
    "legal_desc_1": "legal", "legal_desc1": "legal",
    "legal_description_1": "legal", "legal_desc": "legal",
    "legal_description": "legal", "legal": "legal",
}


def detect_delimiter(header_line: str) -> str:
    counts = {"|": 0, "\t": 0, ",": 0}
    for ch in header_line:
        if ch in counts:
            counts[ch] += 1
    if counts["|"] >= 3:
        return "|"
    if counts["\t"] >= 3:
        return "\t"
    if counts[","] >= 3:
        return ","
    return "|"


def build_col_map(headers: list[str]) -> dict[int, str]:
    col_map: dict[int, str] = {}
    used: set[str] = set()
    for i, h in enumerate(headers):
        norm = h.lower().replace(" ", "_").replace("-", "_")
        # Remove non-alnum except underscore
        norm = "".join(c for c in norm if c.isalnum() or c == "_")
        canonical = COL_ALIASES.get(norm)
        if canonical and canonical not in used:
            col_map[i] = canonical
            used.add(canonical)
    return col_map


def parse_bulk_file(content: str) -> list[dict]:
    """
    Parse pipe/tab/CSV bulk file into a list of raw row dicts.
    Only returns rows with doc_type matching LP variants.
    """
    lines = [l for l in content.splitlines() if l.strip()]
    if len(lines) < 2:
        log.warning("Bulk file appears empty or has only one line.")
        return []

    delimiter = detect_delimiter(lines[0])
    delim_label = "PIPE" if delimiter == "|" else "TAB" if delimiter == "\t" else "CSV"

    if delimiter == ",":
        reader = csv.reader(io.StringIO(content))
        rows_raw = list(reader)
        headers = [h.strip() for h in rows_raw[0]]
        data_rows = [
            [f.strip() for f in row]
            for row in rows_raw[1:]
            if any(f.strip() for f in row)
        ]
    else:
        all_rows = [line.split(delimiter) for line in lines]
        headers = [h.strip() for h in all_rows[0]]
        data_rows = [
            [f.strip() for f in row]
            for row in all_rows[1:]
            if any(f.strip() for f in row)
        ]

    col_map = build_col_map(headers)
    log.info(f"Bulk file: delimiter={delim_label}, columns={len(headers)}, data_rows={len(data_rows)}")
    log.info(f"Mapped columns: {list(col_map.values())}")

    # Warn about missing critical columns
    mapped_set = set(col_map.values())
    for critical in ["cfn", "record_date", "doc_type", "grantor_1", "grantee_1"]:
        if critical not in mapped_set:
            log.warning(f"Could not map critical column '{critical}' — header row: {lines[0][:200]}")

    records = []
    skipped = 0

    for i, fields in enumerate(data_rows, start=1):
        row: dict[str, str] = {}
        for col_idx, canonical in col_map.items():
            if col_idx < len(fields) and fields[col_idx]:
                row[canonical] = fields[col_idx]

        doc_type = row.get("doc_type", "").lower().strip()
        is_lp = (
            doc_type in LP_DOC_TYPES
            or doc_type.startswith("lis pendens")
            or doc_type == "lp"
        )
        if not is_lp:
            skipped += 1
            continue

        records.append(row)

    log.info(f"Bulk parse: {len(records)} lis pendens, {skipped} non-LP rows skipped")
    return records


# ─── OfficialRecords API Enrichment ──────────────────────────────────────────

def check_units_balance(auth_key: str, session: requests.Session) -> float:
    """Fetch current API unit balance. Halts if ≤ UNITS_HALT_THRESHOLD."""
    try:
        res = backoff_get(
            f"{BASE_URL}api/Account",
            {"AuthKey": auth_key},
            session,
        )
        if res.ok:
            data = res.json()
            balance = float(data.get("UnitsBalance") or data.get("Balance") or data.get("balance") or 0)
            log.info(f"API UnitsBalance: {balance}")
            return balance
    except Exception as exc:
        log.warning(f"Could not fetch UnitsBalance: {exc}")
    return 9999.0  # Unknown — don't halt


def enrich_from_api(
    cfn: Optional[str],
    folio: Optional[str],
    auth_key: str,
    session: requests.Session,
) -> Optional[dict]:
    """
    Call OfficialRecords API to enrich a single record by CFN or folio.
    Returns enrichment dict or None on failure.
    Checks UnitsBalance before each call and halts globally if ≤ 5.
    """
    if not cfn and not folio:
        return None

    params: dict[str, str] = {"AuthKey": auth_key}
    if cfn:
        params["cfn"] = cfn
    elif folio:
        params["folio"] = folio

    try:
        res = backoff_get(OR_API_URL, params, session)
        if not res.ok:
            log.warning(f"OfficialRecords API {res.status_code} for cfn={cfn} folio={folio}")
            return None

        data = res.json()

        # Check balance after each call
        balance = float(data.get("UnitsBalance") or data.get("unitsBalance") or 9999)
        if balance <= UNITS_HALT_THRESHOLD:
            log.error(
                f"UnitsBalance is {balance} — at or below threshold of {UNITS_HALT_THRESHOLD}. "
                "HALTING enrichment to avoid depleting account."
            )
            raise SystemExit(1)

        return data

    except SystemExit:
        raise
    except Exception as exc:
        log.warning(f"OfficialRecords API error for cfn={cfn}: {exc}")
        return None


# ─── Supabase Integration ─────────────────────────────────────────────────────

def get_supabase() -> Client:
    url = get_env("NEXT_PUBLIC_SUPABASE_URL")
    key = get_env("SUPABASE_SERVICE_ROLE_KEY")
    return create_client(url, key)


def is_duplicate(sb: Client, case_number: str, folio: Optional[str]) -> bool:
    """Check if a case/folio already exists in scraper_leads."""
    if folio:
        res = sb.table("scraper_leads").select("id").eq("folio_number", folio).maybe_single().execute()
        if res.data:
            return True
    res = sb.table("scraper_leads").select("id").eq("case_number", case_number).maybe_single().execute()
    return bool(res.data)


def insert_lead(
    sb: Client,
    run_id: str,
    row: dict[str, Any],
    enriched: Optional[dict],
) -> bool:
    """Build and insert a scraper_leads row. Returns True on success."""

    # ── Core fields from bulk file ────────────────────────────────────────────
    cfn        = row.get("cfn") or f"MD-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    record_date = parse_date(row.get("record_date", ""))
    if not record_date:
        record_date = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")

    grantor_1   = row.get("grantor_1", "")
    grantor_2   = row.get("grantor_2", "")
    mortgagor   = "; ".join(filter(None, [grantor_1, grantor_2])) or "UNKNOWN"

    grantee_1   = row.get("grantee_1", "")
    grantee_2   = row.get("grantee_2", "")
    plaintiff   = "; ".join(filter(None, [grantee_1, grantee_2])) or "UNKNOWN"

    amount      = parse_money(row.get("amount", "0"))
    folio       = row.get("folio")
    legal       = row.get("legal")

    # ── Enrichment fields (OfficialRecords API) ───────────────────────────────
    owner_name       = None
    property_address = None
    city             = None
    zip_code         = None
    beds             = None
    baths            = None
    year_built       = None
    living_area      = None
    assessed_value   = None
    market_value     = None
    homestead        = False
    sold_price       = None
    last_sale_date   = None

    if enriched:
        # Party names from API may be more complete than bulk file
        api_grantors = enriched.get("Grantors") or enriched.get("grantors") or []
        api_grantees = enriched.get("Grantees") or enriched.get("grantees") or []
        if api_grantors:
            mortgagor = "; ".join(api_grantors)
        if api_grantees:
            plaintiff = "; ".join(api_grantees)

        # Property data
        prop = enriched.get("Property") or enriched.get("property") or {}
        owner_name       = prop.get("OwnerName") or prop.get("ownerName")
        property_address = prop.get("Address") or prop.get("address")
        city             = prop.get("City") or prop.get("city")
        zip_code         = prop.get("Zip") or prop.get("zip") or prop.get("ZipCode")
        beds             = prop.get("Beds") or prop.get("Bedrooms")
        baths            = prop.get("Baths") or prop.get("Bathrooms")
        year_built       = prop.get("YearBuilt")
        living_area      = prop.get("LivingArea") or prop.get("BuildingArea")
        assessed_value   = parse_money(str(prop.get("AssessedValue") or "0")) or None
        market_value     = parse_money(str(prop.get("MarketValue") or "0")) or None
        homestead        = bool(prop.get("Homestead") or prop.get("homestead"))
        sold_price       = parse_money(str(prop.get("SalePrice") or "0")) or None
        last_sale_date   = parse_date(str(prop.get("SaleDate") or ""))

        if not folio:
            folios = enriched.get("FolioNumbers") or enriched.get("folioNumbers") or []
            folio = folios[0] if folios else None
        if not legal:
            legal = enriched.get("LegalDescription") or enriched.get("legalDescription")
        if not amount:
            amount = parse_money(str(enriched.get("Consideration") or "0"))

    # ── Equity calc ───────────────────────────────────────────────────────────
    market_val_for_equity = assessed_value or market_value or sold_price or 0
    equity_dollar  = None
    equity_pct     = None
    equity_tier    = None
    known_debt     = None

    if market_val_for_equity and amount:
        equity_dollar = round(market_val_for_equity - amount)
        equity_pct    = round((equity_dollar / market_val_for_equity) * 100, 1)
        known_debt    = amount
        if equity_pct > 50:
            equity_tier = "High"
        elif equity_pct > 25:
            equity_tier = "Medium"
        elif equity_pct > 0:
            equity_tier = "Low"
        else:
            equity_tier = "None"

    # ── Entity type ───────────────────────────────────────────────────────────
    name_for_entity = owner_name or mortgagor or ""
    nl = name_for_entity.lower()
    if "llc" in nl or "l.l.c" in nl:
        entity_type = "LLC"
    elif any(k in nl for k in ["corp", "inc", "incorporated"]):
        entity_type = "Corporation"
    elif any(k in nl for k in ["trust", "trustee"]):
        entity_type = "Trust"
    elif any(k in nl for k in ["holdings", "properties", "investments", "ventures", "group", "realty"]):
        entity_type = "Investment Company"
    else:
        entity_type = "Individual"

    payload: dict[str, Any] = {
        "scraper_run_id":       run_id,
        "status":               "pending",
        "county":               "miami-dade",
        "case_number":          cfn,
        "file_date":            record_date,
        "plaintiff":            plaintiff,
        "mortgagor":            mortgagor,
        "foreclosure_amount":   amount or None,
        "lender_name":          plaintiff if plaintiff != "UNKNOWN" else None,
        "foreclosure_type":     "P",
        "multiple_liens":       False,
        "folio_number":         folio or None,
        "owner_name":           owner_name,
        "property_address":     property_address,
        "city":                 city,
        "state":                "FL",
        "zip":                  zip_code,
        "beds":                 int(beds) if beds else None,
        "baths":                float(baths) if baths else None,
        "year_built":           int(year_built) if year_built else None,
        "living_area":          float(living_area) if living_area else None,
        "assessed_value":       assessed_value,
        "market_value":         market_value,
        "sold_price":           sold_price,
        "last_sale_date":       last_sale_date,
        "legal_description":    legal,
        "homestead":            homestead,
        "known_debt":           known_debt,
        "equity_percentage":    equity_pct,
        "equity_dollar_amount": equity_dollar,
        "equity_tier":          equity_tier,
        "entity_type":          entity_type,
    }
    # Remove None values to avoid overwriting existing rows
    payload = {k: v for k, v in payload.items() if v is not None}

    try:
        sb.table("scraper_leads").insert(payload).execute()
        return True
    except Exception as exc:
        log.error(f"Supabase insert error for {cfn}: {exc}")
        return False


def auto_import_to_contact(sb: Client, case_number: str, mortgagor: str,
                            plaintiff: str, folio: Optional[str],
                            file_date: str, amount: float,
                            equity_tier: Optional[str], equity_pct: Optional[float],
                            equity_dollar: Optional[float],
                            assessed_value: Optional[float],
                            property_address: Optional[str],
                            owner_name: Optional[str]) -> None:
    """Mirror the lead into the contacts table, just like the TS runner does."""
    display_name = owner_name or mortgagor or "Unknown Owner"
    tags = ["pre-foreclosure", "miami-dade"]
    if equity_tier:
        tags.append(f"equity-{equity_tier.lower()}")

    notes_parts = [
        "Pre-Foreclosure — Miami-Dade County (Bulk Sync)",
        f"Case/CFN: {case_number}",
        f"Folio: {folio}" if folio else "",
        f"Filed: {file_date}" if file_date else "",
        f"Plaintiff: {plaintiff}" if plaintiff else "",
        f"Foreclosure Amount: ${amount:,.0f}" if amount else "",
        f"Equity Tier: {equity_tier} ({equity_pct}% / ${equity_dollar:,.0f})" if equity_tier else "",
        f"Assessed Value: ${assessed_value:,.0f}" if assessed_value else "",
    ]
    notes = "\n".join(p for p in notes_parts if p)

    try:
        res = sb.table("contacts").insert({
            "name":     display_name,
            "phone":    "",
            "address":  property_address or "",
            "category": "Seller",
            "status":   "Active",
            "source":   "County Records — Miami-Dade (Bulk)",
            "tags":     tags,
            "notes":    notes,
        }).select("id").single().execute()

        contact_id = res.data.get("id") if res.data else None
        if contact_id:
            sb.table("scraper_leads").update({
                "status": "imported",
                "imported_to_contact": contact_id,
            }).eq("case_number", case_number).execute()
    except Exception as exc:
        log.warning(f"Contact import error for {case_number}: {exc}")


# ─── Main Pipeline ────────────────────────────────────────────────────────────

def run(lookback_days: int = 7, enrich: bool = True, dry_run: bool = False) -> None:
    auth_key = get_env("MD_CLERK_AUTH_KEY")
    folder   = get_env("MD_FTPAPI_FOLDER", required=False) or "OfficialRecords"

    sb      = get_supabase()
    session = requests.Session()
    session.headers.update({
        "User-Agent": "NextKeyOS/1.0 (contact@nextkeyos.com)",
        "Accept":     "application/json, text/plain, */*",
    })

    log.info(f"Starting Miami-Dade sync | folder={folder} | lookback={lookback_days}d | enrich={enrich} | dry_run={dry_run}")

    # ── Check balance before we start any enrichment ─────────────────────────
    if enrich:
        balance = check_units_balance(auth_key, session)
        if balance <= UNITS_HALT_THRESHOLD:
            log.error(f"UnitsBalance {balance} ≤ {UNITS_HALT_THRESHOLD}. Aborting to protect account.")
            sys.exit(1)

    # ── List available files ──────────────────────────────────────────────────
    available_files = list_ftpapi_files(folder, auth_key, session)
    if not available_files:
        log.error(f"No files found in FTPapi folder '{folder}'. Check MD_FTPAPI_FOLDER env var.")
        sys.exit(1)

    target_files = pick_target_files(available_files, lookback_days)
    if not target_files:
        log.warning("No files matched the lookback window. Nothing to do.")
        return

    # ── Create scraper run record ─────────────────────────────────────────────
    run_id = "dry-run"
    if not dry_run:
        try:
            res = sb.table("scraper_runs").insert({
                "triggered_by": "python-bulk-sync",
                "status":       "running",
            }).select().single().execute()
            run_id = res.data["id"]
            log.info(f"Created scraper_run: {run_id}")
        except Exception as exc:
            log.error(f"Failed to create scraper_runs record: {exc}")
            sys.exit(1)

    total_new = 0
    total_skipped = 0
    total_errors = 0

    # ── Process each target file ──────────────────────────────────────────────
    for filename in target_files:
        log.info(f"--- Processing: {filename} ---")
        try:
            content = download_ftpapi_file(folder, filename, auth_key, session)
        except Exception as exc:
            log.error(f"Failed to download {filename}: {exc}")
            total_errors += 1
            continue

        lp_rows = parse_bulk_file(content)
        log.info(f"{filename}: {len(lp_rows)} lis pendens records to process")

        for i, row in enumerate(lp_rows):
            cfn   = row.get("cfn")
            folio = row.get("folio")
            case_num = cfn or f"MD-{filename}-{i}"

            if not dry_run and is_duplicate(sb, case_num, folio):
                log.debug(f"Duplicate: {case_num}")
                total_skipped += 1
                continue

            # ── Enrich via OfficialRecords API ────────────────────────────────
            enriched: Optional[dict] = None
            if enrich and not dry_run:
                # Re-check balance every 50 calls to stay safe
                if i > 0 and i % 50 == 0:
                    balance = check_units_balance(auth_key, session)
                    if balance <= UNITS_HALT_THRESHOLD:
                        log.error(f"UnitsBalance hit threshold ({balance}). Stopping enrichment.")
                        enrich = False  # Continue without enrichment for rest of run

                if enrich:
                    enriched = enrich_from_api(cfn, folio, auth_key, session)
                    time.sleep(0.2)  # polite rate limiting (~5 req/sec)

            if dry_run:
                log.info(f"[DRY RUN] Would insert: cfn={cfn} grantor={row.get('grantor_1')} grantee={row.get('grantee_1')}")
                total_new += 1
                continue

            success = insert_lead(sb, run_id, row, enriched)
            if success:
                # Auto-import to contacts
                file_date = parse_date(row.get("record_date", "")) or datetime.now().strftime("%Y-%m-%d")
                amount = parse_money(row.get("amount", "0"))
                plaintiff = "; ".join(filter(None, [row.get("grantee_1", ""), row.get("grantee_2", "")]))
                mortgagor = "; ".join(filter(None, [row.get("grantor_1", ""), row.get("grantor_2", "")]))

                auto_import_to_contact(
                    sb, case_number=case_num, mortgagor=mortgagor, plaintiff=plaintiff,
                    folio=folio, file_date=file_date, amount=amount,
                    equity_tier=None, equity_pct=None, equity_dollar=None,
                    assessed_value=None, property_address=None, owner_name=None,
                )
                total_new += 1
            else:
                total_errors += 1

    # ── Update run record ─────────────────────────────────────────────────────
    if not dry_run:
        try:
            sb.table("scraper_runs").update({
                "status":          "failed" if total_errors > 0 and total_new == 0 else "completed",
                "completed_at":    datetime.now(tz=timezone.utc).isoformat(),
                "miami_dade_new":  total_new,
                "miami_dade_skip": total_skipped,
                "miami_dade_err":  total_errors,
                "total_new":       total_new,
                "total_skipped":   total_skipped,
                "total_errors":    total_errors,
            }).eq("id", run_id).execute()
        except Exception as exc:
            log.warning(f"Failed to update scraper_runs record: {exc}")

    log.info(
        f"Miami-Dade sync complete: {total_new} new, {total_skipped} skipped, {total_errors} errors"
    )


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Miami-Dade Clerk bulk data sync")
    parser.add_argument(
        "--days", type=int, default=int(os.environ.get("MD_LOOKBACK_DAYS", "7")),
        help="Number of days to look back (default: 7)"
    )
    parser.add_argument(
        "--no-enrich", action="store_true",
        help="Skip OfficialRecords API enrichment (saves API units)"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Parse files and log what would be inserted, but don't write to Supabase"
    )

    args = parser.parse_args()
    run(
        lookback_days=args.days,
        enrich=not args.no_enrich,
        dry_run=args.dry_run,
    )

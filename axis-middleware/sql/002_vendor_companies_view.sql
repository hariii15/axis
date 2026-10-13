-- Canonical definition of the vendor_companies view.
-- Extracted from the live database (pg_get_viewdef); this file is the
-- source of truth — re-apply with: psql "$DATABASE_URL" -f sql/002_vendor_companies_view.sql
--
-- Flattens company_info + financial_info + contact_details into one
-- table-like source. The axis ModelIndexer only extracts from table
-- sources (SELECT * FROM <source>), which is why this lives as a view
-- instead of raw SQL in the model.
--
-- NOTE: tenant_id is a constant ('public'). Vendor data is a shared
-- catalog with no per-tenant column; the Companies model skips engine
-- tenant term filters (security.openSearch.shared) instead of
-- filtering on this column.

CREATE OR REPLACE VIEW vendor_companies AS
SELECT
  ci.company_id,
  ci.company_name,
  ci.pan,
  ci.gst,
  ci.msme,
  ci.msme_type,
  ci.msme_classification,
  ci.cin,
  fi.turnover_2023_24,
  fi.turnover_2024_25,
  fi.turnover_2025_26,
  cd.contact_name,
  cd.contact_number,
  cd.email_id,
  'public'::text AS tenant_id
FROM company_info ci
LEFT JOIN financial_info fi ON fi.company_id = ci.company_id
LEFT JOIN contact_details cd ON cd.company_id = ci.company_id;

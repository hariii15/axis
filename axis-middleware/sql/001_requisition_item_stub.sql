-- Stub for upeg.requisition_item (dev/test only).
-- The PurchaseRequisitions model references this table in the
-- hasAssignedBuyer axis:
--   EXISTS (SELECT 1 FROM upeg.requisition_item ri
--           WHERE ri.requisition_id = requisition_id
--             AND ri.last_buyer_assignment_date IS NOT NULL)
-- The production table does not exist in this database yet, so this
-- stub (same shape, minimal seed) keeps assignedCount answerable.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS upeg.requisition_item (
  requisition_id VARCHAR(50) NOT NULL,
  last_buyer_assignment_date TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS requisition_item_requisition_id_idx
  ON upeg.requisition_item (requisition_id);

-- Minimal seed: REQ-0000001 assigned, REQ-0000002 explicitly unassigned
-- (NULL date), REQ-0000003 has no row at all (unassigned).
DELETE FROM upeg.requisition_item
WHERE requisition_id IN ('REQ-0000001', 'REQ-0000002');

INSERT INTO upeg.requisition_item (requisition_id, last_buyer_assignment_date)
VALUES
  ('REQ-0000001', NOW()),
  ('REQ-0000002', NULL);

-- Preserve the legacy shared values once, then store each record independently.
BEGIN;
LOCK TABLE record_batches, record_data IN SHARE ROW EXCLUSIVE MODE;
UPDATE record_data r
SET raw_data = COALESCE(b.shared_data, '{}'::jsonb) || COALESCE(r.raw_data, '{}'::jsonb)
FROM record_batches b
WHERE r.record_batch_id = b.id AND COALESCE(b.shared_data, '{}'::jsonb) <> '{}'::jsonb;
UPDATE record_batches SET shared_data = '{}'::jsonb WHERE shared_data <> '{}'::jsonb;
COMMIT;

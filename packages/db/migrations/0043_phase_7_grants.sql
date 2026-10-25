-- Hand-written (ADR 0009, phase-7-plan §4): FORCE ROW LEVEL SECURITY, grants
-- and updated_at triggers for the Phase 7 tables, the couriers' area lists,
-- and the poll's list of quiet courier shipments across stores.

ALTER TABLE store.shipment_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.courier_payouts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.courier_payout_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Courier events are appended, never changed. A payout's lines can be
-- corrected by deleting the payout (a mistaken import), which cascades.
GRANT SELECT, INSERT ON store.shipment_events TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON store.courier_payouts TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON store.courier_payout_lines TO app_rw;
--> statement-breakpoint

CREATE TRIGGER courier_payouts_set_updated_at BEFORE UPDATE ON store.courier_payouts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- The couriers' places are written by the weekly sync, as the migration
-- role; the app reads them, and a super admin's match is saved through it.
GRANT SELECT ON ref.courier_areas TO app_rw, mm_system;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ref.courier_area_map TO app_rw;
--> statement-breakpoint
GRANT SELECT ON ref.courier_area_map TO mm_system;
--> statement-breakpoint
CREATE TRIGGER courier_area_map_set_updated_at BEFORE UPDATE ON ref.courier_area_map
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- The poll (§3.5): open courier shipments not heard from for `quiet_hours`,
-- at most `max_days` old, across stores. A SECURITY DEFINER function owned by
-- mm_system, like app.sale_edges: mm_system reads only these shipments'
-- identifying columns, and only here.
GRANT SELECT (tenant_id, id, courier, status, consignment_id, last_synced_at, booked_at, created_at)
  ON store.shipments TO mm_system;
--> statement-breakpoint
CREATE POLICY system_courier_poll ON store.shipments FOR SELECT TO mm_system
  USING (courier IS NOT NULL AND status IN ('booked', 'shipped', 'in_transit', 'failed'));
--> statement-breakpoint
CREATE FUNCTION app.courier_poll_due(
  quiet_hours integer DEFAULT 6,
  max_days integer DEFAULT 30,
  max_rows integer DEFAULT 2000
)
  RETURNS TABLE (tenant_id uuid, shipment_id uuid, courier text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.tenant_id, s.id, s.courier
    FROM store.shipments s
   WHERE s.courier IS NOT NULL
     AND s.status IN ('booked', 'shipped', 'in_transit', 'failed')
     AND coalesce(s.last_synced_at, s.booked_at, s.created_at)
         < now() - make_interval(hours => quiet_hours)
     AND coalesce(s.booked_at, s.created_at) > now() - make_interval(days => max_days)
   ORDER BY s.tenant_id, s.courier
   LIMIT least(max_rows, 10000)
$$;
--> statement-breakpoint
ALTER FUNCTION app.courier_poll_due(integer, integer, integer) OWNER TO mm_system;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.courier_poll_due(integer, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.courier_poll_due(integer, integer, integer) TO app_rw;

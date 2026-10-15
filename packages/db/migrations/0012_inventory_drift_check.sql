-- Hand-written (phase-2-plan §3.8): the daily check that every stock level
-- still equals the sum of its movements, across all stores. A SECURITY
-- DEFINER function owned by mm_system, like the outbox sweep (migration
-- 0003): mm_system may only read levels and movements, and only here.
GRANT SELECT ON store.inventory_levels, store.stock_movements TO mm_system;
--> statement-breakpoint
CREATE POLICY system_drift_check ON store.inventory_levels FOR SELECT TO mm_system USING (true);
--> statement-breakpoint
CREATE POLICY system_drift_check ON store.stock_movements FOR SELECT TO mm_system USING (true);
--> statement-breakpoint
CREATE FUNCTION app.inventory_drift(max_rows integer DEFAULT 100)
  RETURNS TABLE (tenant_id uuid, variant_id uuid, location_id uuid,
                 on_hand bigint, reserved bigint, moved_on_hand bigint, moved_reserved bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(l.tenant_id, m.tenant_id), coalesce(l.variant_id, m.variant_id),
         coalesce(l.location_id, m.location_id),
         coalesce(l.on_hand, 0)::bigint, coalesce(l.reserved, 0)::bigint,
         coalesce(m.on_hand, 0)::bigint, coalesce(m.reserved, 0)::bigint
    FROM store.inventory_levels l
    FULL JOIN (
      SELECT tenant_id, variant_id, location_id,
             sum(quantity) FILTER (WHERE type IN ('receive', 'return', 'adjustment', 'sale')) AS on_hand,
             sum(quantity) FILTER (WHERE type IN ('reservation', 'release')) AS reserved
        FROM store.stock_movements
       GROUP BY tenant_id, variant_id, location_id) m
      ON m.tenant_id = l.tenant_id AND m.variant_id = l.variant_id AND m.location_id = l.location_id
   WHERE coalesce(l.on_hand, 0) <> coalesce(m.on_hand, 0)
      OR coalesce(l.reserved, 0) <> coalesce(m.reserved, 0)
   LIMIT least(max_rows, 1000)
$$;
--> statement-breakpoint
ALTER FUNCTION app.inventory_drift(integer) OWNER TO mm_system;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.inventory_drift(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.inventory_drift(integer) TO app_rw;

-- Hand-written (ADR 0009, phase-8-plan §4): FORCE ROW LEVEL SECURITY, grants
-- and updated_at triggers for the back office's tables, and the new
-- `backOffice` feature in every stored plan and store entitlement.

ALTER TABLE store.suppliers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.purchase_orders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.purchase_order_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.goods_receipts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.goods_receipt_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.supplier_payments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.cost_changes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.stock_counts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.stock_count_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.expense_categories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.recurring_expenses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.expenses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.daily_sales FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.daily_product_sales FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.monthly_stock_values FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Suppliers are archived, never deleted (§3.1). A draft PO can be deleted
-- with its lines; an ordered one can gain and lose lines not yet received.
GRANT SELECT, INSERT, UPDATE ON store.suppliers TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON store.purchase_orders TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON store.purchase_order_lines TO app_rw;
--> statement-breakpoint
-- A receipt is the record of what arrived and what it cost: never changed.
GRANT SELECT, INSERT ON store.goods_receipts TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT ON store.goods_receipt_lines TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON store.supplier_payments TO app_rw;
--> statement-breakpoint
-- The cost history is appended, as the stock ledger is.
GRANT SELECT, INSERT ON store.cost_changes TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON store.stock_counts TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON store.stock_count_lines TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON store.expense_categories TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON store.recurring_expenses TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON store.expenses TO app_rw;
--> statement-breakpoint
-- The summaries are replaced by the nightly refresh, inside the store's own
-- transaction (§3.9, ADR 0031): deleted and inserted, never updated.
GRANT SELECT, INSERT, DELETE ON store.daily_sales TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON store.daily_product_sales TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON store.monthly_stock_values TO app_rw;
--> statement-breakpoint

CREATE TRIGGER suppliers_set_updated_at BEFORE UPDATE ON store.suppliers
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER purchase_orders_set_updated_at BEFORE UPDATE ON store.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER supplier_payments_set_updated_at BEFORE UPDATE ON store.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER stock_counts_set_updated_at BEFORE UPDATE ON store.stock_counts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER expense_categories_set_updated_at BEFORE UPDATE ON store.expense_categories
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER recurring_expenses_set_updated_at BEFORE UPDATE ON store.recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER expenses_set_updated_at BEFORE UPDATE ON store.expenses
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- The new feature (§3.11, Q13): on for every plan but Starter. Entitlements
-- are validated strictly, so a stored set without it would read as invalid.
UPDATE platform.plans
   SET entitlements = jsonb_set(entitlements, '{features,backOffice}', to_jsonb(code <> 'starter'))
 WHERE entitlements ? 'features' AND NOT (entitlements -> 'features' ? 'backOffice');
--> statement-breakpoint
-- A store's effective set follows its plan and override; a store with a set
-- but no subscription keeps every feature, as stores from before plans do.
UPDATE platform.tenants t
   SET entitlements = jsonb_set(t.entitlements, '{features,backOffice}', coalesce(
         (SELECT coalesce(s.entitlement_override -> 'features' -> 'backOffice',
                          p.entitlements -> 'features' -> 'backOffice')
            FROM platform.subscriptions s JOIN platform.plans p ON p.id = s.plan_id
           WHERE s.tenant_id = t.id),
         'true'::jsonb))
 WHERE t.entitlements ? 'features' AND NOT (t.entitlements -> 'features' ? 'backOffice');

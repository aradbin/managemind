import { createFileRoute } from '@tanstack/react-router';
import { StockCountsPage } from '../../../../pages/stock-counts';

export const Route = createFileRoute('/_shell/inventory/counts/')({ component: StockCountsPage });

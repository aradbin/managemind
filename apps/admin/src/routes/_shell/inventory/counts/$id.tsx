import { createFileRoute } from '@tanstack/react-router';
import { StockCountPage } from '../../../../pages/stock-count';

export const Route = createFileRoute('/_shell/inventory/counts/$id')({ component: StockCountPage });

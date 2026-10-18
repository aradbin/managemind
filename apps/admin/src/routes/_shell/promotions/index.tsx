import { createFileRoute } from '@tanstack/react-router';
import { defined, searchOneOf, searchText } from '../../../lib/search';
import { PromotionsPage } from '../../../pages/promotions';

export const Route = createFileRoute('/_shell/promotions/')({
  validateSearch: (search: Record<string, unknown>) =>
    defined({
      q: searchText(search.q, 100),
      state: searchOneOf(search.state, ['draft', 'scheduled', 'live', 'paused', 'ended'] as const),
      kind: searchOneOf(search.kind, ['automatic', 'code'] as const),
    }),
  component: PromotionsPage,
});

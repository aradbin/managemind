// What a stock count covers, as specifically as its scope says: "Category:
// Panjabi", "Tag: eid", "3 items chosen", "Everything at this location".
// The counts list and a count's page both read it (ADR 0034).
import { useQuery } from '@tanstack/react-query';
import { useLocale } from '../i18n';
import '../i18n/purchasing';
import { categoriesQuery, categoryOptions } from './catalog';

type ScopeKind = 'all' | 'category' | 'tag' | 'variants';

export function useCountScope() {
  const { t, locale } = useLocale();
  const categories = useQuery(categoriesQuery);
  return (c: { scope: unknown; lineCount: number }) => {
    const scope = c.scope as {
      kind: ScopeKind;
      categoryId?: string;
      tag?: string;
      variantIds?: string[];
    };
    if (scope.kind === 'category') {
      const name = categoryOptions(categories.data ?? [], locale).find(
        (o) => o.id === scope.categoryId,
      )?.label;
      return name ? t('counts.whatCategory', { name }) : t('counts.scope.category');
    }
    if (scope.kind === 'tag' && scope.tag) return t('counts.whatTag', { tag: scope.tag });
    if (scope.kind === 'variants') {
      return t('counts.whatItems', { count: scope.variantIds?.length ?? c.lineCount });
    }
    return t(`counts.scope.${scope.kind}`);
  };
}

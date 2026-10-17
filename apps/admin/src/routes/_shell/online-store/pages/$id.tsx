import { createFileRoute } from '@tanstack/react-router';
import { StorePageEditorPage } from '../../../../pages/store-pages';

export const Route = createFileRoute('/_shell/online-store/pages/$id')({ component: Page });

function Page() {
  const { id } = Route.useParams();
  return <StorePageEditorPage id={id} />;
}

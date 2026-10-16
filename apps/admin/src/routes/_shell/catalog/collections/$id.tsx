import { createFileRoute } from '@tanstack/react-router';
import { CollectionEditorPage } from '../../../../pages/collections';

export const Route = createFileRoute('/_shell/catalog/collections/$id')({ component: Page });

function Page() {
  const { id } = Route.useParams();
  return <CollectionEditorPage id={id} />;
}

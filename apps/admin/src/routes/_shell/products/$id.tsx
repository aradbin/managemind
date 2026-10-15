import { createFileRoute } from '@tanstack/react-router';
import { ProductEditorPage } from '../../../pages/product-editor';

export const Route = createFileRoute('/_shell/products/$id')({ component: Page });

function Page() {
  const { id } = Route.useParams();
  return <ProductEditorPage id={id} />;
}

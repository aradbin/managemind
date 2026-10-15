import { createFileRoute } from '@tanstack/react-router';
import { AttributesPage } from '../../../pages/attributes';

export const Route = createFileRoute('/_shell/catalog/attributes')({ component: AttributesPage });

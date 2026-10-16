import { createFileRoute } from '@tanstack/react-router';
import { NewProductPage } from '../../../pages/product-editor';

export const Route = createFileRoute('/_shell/products/new')({ component: NewProductPage });

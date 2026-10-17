import { createFileRoute } from '@tanstack/react-router';
import { PromotionPage } from '../../../pages/promotion-editor';

export const Route = createFileRoute('/_shell/promotions/$id')({ component: PromotionPage });

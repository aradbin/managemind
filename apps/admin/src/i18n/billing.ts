// Importing this registers the billing screens' messages (see addMessages).
import { billingBn } from './billing-bn';
import { billingEn } from './billing-en';
import { addMessages } from './index';

addMessages({ en: billingEn, bn: billingBn });

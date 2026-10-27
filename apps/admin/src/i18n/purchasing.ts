// Importing this registers the purchasing screens' messages (see addMessages).
import { addMessages } from './index';
import { purchasingBn } from './purchasing-bn';
import { purchasingEn } from './purchasing-en';

addMessages({ en: purchasingEn, bn: purchasingBn });

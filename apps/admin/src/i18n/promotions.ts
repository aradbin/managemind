// Importing this registers the promotion screens' messages (see addMessages).
import { addMessages } from './index';
import { promotionsBn } from './promotions-bn';
import { promotionsEn } from './promotions-en';

addMessages({ en: promotionsEn, bn: promotionsBn });

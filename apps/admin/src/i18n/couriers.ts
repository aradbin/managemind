// Importing this registers the courier screens' messages (see addMessages).
import { couriersBn } from './couriers-bn';
import { couriersEn } from './couriers-en';
import { addMessages } from './index';

addMessages({ en: couriersEn, bn: couriersBn });

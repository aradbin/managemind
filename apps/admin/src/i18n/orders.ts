// Importing this registers the orders screens' messages (see addMessages).
import { addMessages } from './index';
import { ordersBn } from './orders-bn';
import { ordersEn } from './orders-en';

addMessages({ en: ordersEn, bn: ordersBn });

// Importing this registers the online store's messages (see addMessages).
import { addMessages } from './index';
import { onlineStoreBn } from './online-store-bn';
import { onlineStoreEn } from './online-store-en';

addMessages({ en: onlineStoreEn, bn: onlineStoreBn });

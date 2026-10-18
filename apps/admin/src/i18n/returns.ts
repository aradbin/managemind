// Importing this registers the returns screens' messages (see addMessages).
import { addMessages } from './index';
import { returnsBn } from './returns-bn';
import { returnsEn } from './returns-en';

addMessages({ en: returnsEn, bn: returnsBn });

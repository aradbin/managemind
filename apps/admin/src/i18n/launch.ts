// Importing this registers the launch screens' messages (see addMessages).
import { addMessages } from './index';
import { launchBn } from './launch-bn';
import { launchEn } from './launch-en';

addMessages({ en: launchEn, bn: launchBn });

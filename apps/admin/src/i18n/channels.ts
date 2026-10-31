// Importing this registers the sales channel screens' messages (see addMessages).
import { channelsBn } from './channels-bn';
import { channelsEn } from './channels-en';
import { addMessages } from './index';

addMessages({ en: channelsEn, bn: channelsBn });

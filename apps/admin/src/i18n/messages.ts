// Importing this registers the alerts and messages screens' messages (see addMessages).
import { addMessages } from './index';
import { messagesBn } from './messages-bn';
import { messagesEn } from './messages-en';

addMessages({ en: messagesEn, bn: messagesBn });

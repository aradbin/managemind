// Importing this registers the back office reports' messages (see addMessages).
import { boReportsBn } from './back-office-reports-bn';
import { boReportsEn } from './back-office-reports-en';
import { addMessages } from './index';

addMessages({ en: boReportsEn, bn: boReportsBn });

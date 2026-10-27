// Importing this registers the expenses screens' messages (see addMessages).
import { expensesBn } from './expenses-bn';
import { expensesEn } from './expenses-en';
import { addMessages } from './index';

addMessages({ en: expensesEn, bn: expensesBn });

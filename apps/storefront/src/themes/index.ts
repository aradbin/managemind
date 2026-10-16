// Every theme, by the name stored in the store's theme settings.
import * as classic from './classic/index';

export const THEMES = { classic } as const;
export type ThemeTemplates = (typeof THEMES)['classic'];

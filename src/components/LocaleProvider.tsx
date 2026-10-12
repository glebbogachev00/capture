"use client";

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { deviceLocale, translate, type Locale } from "@/lib/i18n";

/* A page drawn on the server (the login screen) learns the language from the
   request, so the server's HTML and the browser agree. Everything drawn only
   in the browser reads the device directly. */
const LocaleContext = createContext<Locale | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  useDocumentLanguage(locale);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

const noSubscription = () => () => {};

/** Inside a provider, its language. Otherwise the device's, but only after
 * the page has loaded: while React takes over the server's HTML it must draw
 * the same English the server drew. */
export function useLocale(): Locale {
  const provided = useContext(LocaleContext);
  const device = useSyncExternalStore(noSubscription, deviceLocale, () => "en" as const);
  return provided ?? device;
}

/** t() for components that can be drawn on the server. */
export function useT() {
  const locale = useLocale();
  return useCallback((text: string, vars?: Record<string, string | number>) => translate(locale, text, vars), [locale]);
}

/** The page says which language it is in, so the phone neither offers to
 * translate Russian it reads as English nor reads it aloud as English. */
export function useDocumentLanguage(locale: Locale) {
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
}

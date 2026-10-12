import { t } from "./i18n";

/* The server writes its errors in English; the ones a person can meet are
   shown in their language. Operator setup errors (keys, billing) stay as they are. */
export const serverMessage = (message: string) => {
  if (message === "The sort didn't go through.") return t("The sort didn't go through.");
  if (message === "The model declined to sort that one.") return t("The model declined to sort that one.");
  if (message === "rate limited") return t("Too many requests at once — wait a moment and try again.");
  const busy = message.match(/^(.+) is rate-limiting or the daily free quota is spent\. Try again shortly\.$/);
  if (busy) return t("{name} is rate-limiting or the daily free quota is spent. Try again shortly.", { name: busy[1] });
  return message;
};

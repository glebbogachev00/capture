/**
 * The rules every engine files by.
 *
 * These lived inside the sort route, private to it — which is exactly why
 * Distill got them wrong. A conversation settled through Distill could not
 * route into an existing thread and never read a deadline, because the
 * knowledge of how to do either sat in a file it did not import. Two
 * engines filing into one board have to agree about what belonging means,
 * so the rules live here and both read from the same copy.
 */

/** The sorter cannot resolve "friday" without knowing what today is, and it
    has never been told. Local time, since the person speaking means theirs. */
export function todayLine(): string {
  const d = new Date();
  const day = d.toLocaleDateString("en-US", { weekday: "long" });
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `Today is ${day}, ${date}.\n`;
}

export const DUE_RULE =
  '\nIf the capture names a deadline of its own — "before Friday", "by the 28th", ' +
  '"tomorrow morning" — resolve it against today\'s date and return it in "due" ' +
  'as an ISO date (add a time only when one was actually said). Return null when ' +
  'no date is stated. Do NOT invent a deadline for something merely urgent-sounding, ' +
  'and do not treat a date that is part of the subject ("the 1998 recording") as a ' +
  "deadline.\n";

/**
 * How to choose a thread — the rule the sorter was missing.
 *
 * Threads were being picked on shared words rather than shared subject. A
 * thread named "Capture." swallowed every capture containing the word
 * "capture", whatever it was actually about, because the word was right
 * there in the name. The same trap waits behind any thread whose name is an
 * ordinary word. Belonging is about subject; a word in common is not one.
 */
export const ROUTING_RULE =
  "\nChoosing a thread — read this before you set threadId:\n" +
  "- FIRST, a series. If the capture immediately before this one landed " +
  "minutes ago and this is the same kind of thing — another draft in a set, " +
  "the next entry in a log, another paste of the same shape — then this one " +
  "goes on the thread that one opened or joined. That holds even when the " +
  "thread is named after the app and even when the two drafts are about " +
  "different things: the person is building a set, not changing subject, " +
  "and three drafts in three threads is a pile. Only when this is NOT a " +
  "continuation do the tests below apply.\n" +
  "- A thread fits when the capture is ABOUT the same subject and would " +
  "genuinely be read alongside what is already in it. That is the only test.\n" +
  "- Words in common are not a reason. A capture that merely uses a word " +
  "appearing in a thread's name or summary does not belong there. A thread " +
  'named for an ordinary word — "Capture.", "Work", "Ideas" — is the easiest ' +
  "one to file into wrongly for exactly this reason, so hold it to the " +
  "subject test like any other.\n" +
  "- Threads named after the app, the tool, or the act of writing notes are " +
  "about THAT subject. A capture is not about capturing simply because it " +
  "was captured — but a capture that genuinely IS about building the app " +
  "(its sorting engine, its board, its sync, a bug in it) belongs in that " +
  "thread exactly as any other subject would. The caution is against the " +
  "word, not the subject.\n" +
  "- When no thread genuinely fits, set threadId to null and invent a short " +
  "threadName. A new thread is cheap and honest; a wrong one buries the note " +
  "where it will not be found again.\n" +
  "\nWhen one capture is about TWO subjects — `also`:\n" +
  "- A person says two things in one breath more often than they say one. " +
  '"Retake is slow on my machine and Capture keeps mis-sorting" is not one ' +
  "thought that mentions two apps; it is two thoughts said together. Filing " +
  "the whole sentence in one thread puts half of it somewhere its owner will " +
  "never look for it.\n" +
  "- So: the primary destination takes the part it is about, and each further " +
  "subject goes in `also` with ONLY its own share of the words. Never repeat " +
  "the same sentence in two places — split it, do not copy it.\n" +
  "- `clean` still holds the WHOLE capture, exactly as always — it is the " +
  "record of what was said. The primary destination's share goes in " +
  "`primaryText`, and the words you put in `also` must not appear there. " +
  "Filing the whole capture in the primary AND a copy of half of it " +
  "elsewhere is worse than not splitting at all: the person now has to " +
  "notice the duplicate and delete it.\n" +
  "- The bar is high. Two subjects means two things that would be read in " +
  "different places on different days. A capture that mentions another thread " +
  "in passing, or compares one thing to another, is ONE thought about one " +
  "subject — leave `also` empty. So is a list of steps toward a single goal.\n" +
  "- Empty is the normal answer. Most captures are about one thing, and a " +
  "split that was not really there is worse than no split at all: it tears a " +
  "sentence in half and files the halves apart.\n";


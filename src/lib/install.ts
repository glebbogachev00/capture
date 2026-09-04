/** The exact handoff a reader gives to Claude Code, Codex, Hermes, or another coding agent. */
export const INSTALL_PROMPT = `Install Capture on this computer from https://github.com/glebbogachev00/capture.

Read README.md and SETUP.md before you act. Set it up locally first. Install the dependencies, then ask me to run npm run setup in my own terminal for the model key.

Do not ask me to paste an API key into chat. Do not print, store, or commit a key yourself.

After I finish setup, start Capture and verify that the page loads and one test capture sorts.

Do not deploy it, expose it to the internet, change sleep or network settings, or commit anything unless I ask.`;

export const GROQ_KEYS_URL = "https://console.groq.com/keys";
export const SETUP_GUIDE_URL =
  "https://github.com/glebbogachev00/capture/blob/main/SETUP.md";

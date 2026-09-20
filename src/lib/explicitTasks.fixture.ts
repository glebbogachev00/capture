/** Diagnostic input, not a canned model response. Expected labels allow equivalent live wording. */
export const explicitTasksRaw = "I need to fix the signup error that only appears after an invite is accepted, and test the pricing experiment comparing usage-based billing with seats. The build is getting slow after the new analytics package, so I should profile the render path before we add another dashboard. I also need to document onboarding so a new developer can run the app without asking me where the environment variables come from. While I am in there, I keep thinking about a later product idea: a tiny release assistant that turns a pull request into a clear customer update.";

export const explicitTasks = [
  "Fix the signup error after invite acceptance",
  "Test usage-based pricing against per-seat pricing",
  "Profile the render path before adding another dashboard",
  "Document onboarding so a new developer can run the app independently",
];

export const releaseIdea = "a tiny release assistant that turns a pull request into a clear customer update";

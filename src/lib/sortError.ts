export class SortError extends Error {
  constructor(message = "", readonly quiet = false) {
    super(message);
  }
}

// A request refused with an HTTP status and a `{code, error}` body — cc's
// refusals passed through, and the plugin's own.
export class Refusal extends Error {
  constructor(status, code, error) {
    super(error);
    this.status = status;
    this.code = code;
    this.error = error;
  }
}

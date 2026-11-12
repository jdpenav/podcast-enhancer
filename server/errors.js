// Error HTTP con código del contrato (docs/API.md) y mensaje en español.
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.statusCode = status
    this.code = code
  }
}

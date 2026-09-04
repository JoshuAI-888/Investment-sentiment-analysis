/** F15 §4.1/§4.4 — the conflict shape every mutation returns instead of a silent overwrite. */
export class AdminMutationConflictError extends Error {
  readonly objectId: string | null;
  readonly diff: { readonly expected: unknown; readonly actual: unknown };

  constructor(
    message: string,
    args: { readonly objectId: string | null; readonly expected: unknown; readonly actual: unknown },
  ) {
    super(message);
    this.name = 'AdminMutationConflictError';
    this.objectId = args.objectId;
    this.diff = { expected: args.expected, actual: args.actual };
  }
}

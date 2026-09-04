export class McpToolError extends Error {
  constructor(
    readonly code: 'not_found' | 'ambiguous' | 'ineligible' | 'invalid_arguments' | 'unresolvable_calculation',
    message: string,
  ) {
    super(message);
    this.name = 'McpToolError';
  }
}

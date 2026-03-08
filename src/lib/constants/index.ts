/**
 * Shared string constants.
 *
 * Pattern: const object + `as const` + exported type (no enums).
 * Example: export const FOO = { BAR: "bar", BAZ: "baz" } as const;
 *          export type Foo = (typeof FOO)[keyof typeof FOO];
 * Import from here or from the specific module.
 */
export * from "./job-status";
export * from "./credit-transaction-kind";
export * from "./user-role";
export * from "./webhook-job-status";
export * from "./job-error-messages";
export * from "./stripe-metadata";

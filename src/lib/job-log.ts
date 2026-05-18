type JobLogFields = Record<string, unknown>;

function formatFields(fields?: JobLogFields): JobLogFields | undefined {
  if (!fields) return undefined;
  const out: JobLogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Structured info log for job pipeline observability. */
export function jobLog(
  component: string,
  message: string,
  fields?: JobLogFields
): void {
  const payload = formatFields(fields);
  if (payload) {
    console.log(`[job:${component}] ${message}`, payload);
  } else {
    console.log(`[job:${component}] ${message}`);
  }
}

/** Structured error log for job pipeline observability. */
export function jobLogError(
  component: string,
  message: string,
  fields?: JobLogFields
): void {
  const payload = formatFields(fields);
  if (payload) {
    console.error(`[job:${component}] ${message}`, payload);
  } else {
    console.error(`[job:${component}] ${message}`);
  }
}

import { JOB_ERROR } from "@/lib/constants/job-error-messages";

/** True when the job was canceled via the UI (errorMessage is set before status may settle). */
export function isJobCanceled(errorMessage: string | null | undefined): boolean {
  return errorMessage === JOB_ERROR.CANCELED;
}

/** Dropbox path or `id:…` for a job's source file (download / preview). */
export function jobDropboxSourcePathOrId(job: {
  dropboxSourceFilePath: string;
  dropboxSourceFileId: string | null;
}): string {
  if (job.dropboxSourceFileId) {
    return job.dropboxSourceFileId.startsWith("id:")
      ? job.dropboxSourceFileId
      : `id:${job.dropboxSourceFileId}`;
  }
  return job.dropboxSourceFilePath;
}

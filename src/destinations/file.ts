import type { RenderJob } from "../core/types.js";
/** Save a completed file into a fresh run folder; never replace an existing run. */
export async function saveFileToDirectory(
  directory: FileSystemDirectoryHandle,
  job: RenderJob,
  blob: Blob,
  signal: AbortSignal,
) {
  const name = job.fileName ?? job.id;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(name)) throw Error("Invalid file name");
  signal.throwIfAborted();
  const folder = await directory.getDirectoryHandle(
    `${name}-${crypto.randomUUID()}`,
    { create: true },
  );
  const file = await folder.getFileHandle(`${name}.mp4`, { create: true });
  const writer = await file.createWritable();
  try {
    await writer.write(blob);
    signal.throwIfAborted();
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
}

// Status of a remember job that was still uploading when the tool call
// returned (status: "pending"). The memory card polls this until the relayer
// reports done (with the Walrus blob id) or failed.

import { jobStatus } from "@/lib/memwal";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    return Response.json({ error: "bad job id" }, { status: 400 });
  }
  try {
    const s = await jobStatus(id);
    return Response.json({
      job_id: s.job_id,
      status: s.status,
      memory_id: s.blob_id,
      error: s.error,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

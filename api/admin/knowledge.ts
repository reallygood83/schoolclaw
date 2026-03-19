import { list, head } from "@vercel/blob";

export async function GET(): Promise<Response> {
	try {
		const { blobs } = await list({ prefix: "documents/" });
		const extractedBlobs = blobs.filter((b) => b.pathname.endsWith(".extracted.json"));

		const allParagraphs: string[] = [];
		const sources: { filename: string; paragraphs: number; uploadedAt: string }[] = [];

		for (const blob of extractedBlobs) {
			try {
				const res = await fetch(blob.downloadUrl);
				const data = (await res.json()) as { paragraphs: string[]; filename: string; uploadedAt: string };
				allParagraphs.push(...data.paragraphs);
				sources.push({ filename: data.filename, paragraphs: data.paragraphs.length, uploadedAt: data.uploadedAt });
			} catch {
				continue;
			}
		}

		return new Response(
			JSON.stringify({
				totalParagraphs: allParagraphs.length,
				sources,
				knowledge: allParagraphs.join("\n"),
			}),
			{ headers: { "Content-Type": "application/json" } },
		);
	} catch (err) {
		return new Response(
			JSON.stringify({ totalParagraphs: 0, sources: [], knowledge: "", error: err instanceof Error ? err.message : "Unknown error" }),
			{ headers: { "Content-Type": "application/json" } },
		);
	}
}

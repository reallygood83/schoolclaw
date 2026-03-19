import { list } from "@vercel/blob";

export async function GET(): Promise<Response> {
	const { blobs } = await list({ prefix: "documents/" });
	const extractedBlobs = blobs.filter((b) => b.pathname.endsWith(".extracted.json"));

	const allParagraphs: string[] = [];
	const sources: { filename: string; paragraphs: number; uploadedAt: string }[] = [];

	for (const blob of extractedBlobs) {
		try {
			const res = await fetch(blob.url);
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
}

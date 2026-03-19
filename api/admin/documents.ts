import { list, put, del } from "@vercel/blob";
import { extractTextFromHwpx } from "../lib/hwpx-extract.js";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "schoolclaw2026";

function checkAuth(req: Request): boolean {
	const authHeader = req.headers.get("authorization");
	if (!authHeader) return false;
	const token = authHeader.replace("Bearer ", "");
	return token === ADMIN_PASSWORD;
}

function unauthorized(): Response {
	return new Response(JSON.stringify({ error: "Unauthorized" }), {
		status: 401,
		headers: { "Content-Type": "application/json" },
	});
}

export async function GET(req: Request): Promise<Response> {
	if (!checkAuth(req)) return unauthorized();

	const { blobs } = await list({ prefix: "documents/" });
	const documents = blobs.map((blob) => ({
		url: blob.url,
		pathname: blob.pathname,
		filename: blob.pathname.replace("documents/", "").replace(/^[^/]+\//, ""),
		size: blob.size,
		uploadedAt: blob.uploadedAt,
	}));

	return new Response(JSON.stringify({ documents }), {
		headers: { "Content-Type": "application/json" },
	});
}

export async function POST(req: Request): Promise<Response> {
	if (!checkAuth(req)) return unauthorized();

	try {
		const formData = await req.formData();
		const file = formData.get("file") as File | null;

		if (!file) {
			return new Response(JSON.stringify({ error: "No file provided" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		}

		const filename = file.name;
		const buffer = await file.arrayBuffer();
		const timestamp = Date.now();

		let extractedText: string[] = [];
		if (filename.toLowerCase().endsWith(".hwpx")) {
			try {
				extractedText = await extractTextFromHwpx(buffer);
			} catch (extractErr) {
				console.error("HWPX extraction failed:", extractErr);
			}
		}

		const blobPath = `documents/${timestamp}/${filename}`;
		const fileBody = new Blob([buffer], { type: file.type || "application/octet-stream" });
		const blob = await put(blobPath, fileBody, {
			access: "public",
			contentType: file.type || "application/octet-stream",
		});

		const textBlobPath = `documents/${timestamp}/${filename}.extracted.json`;
		const jsonBody = JSON.stringify({ paragraphs: extractedText, filename, uploadedAt: new Date().toISOString() });
		await put(textBlobPath, jsonBody, {
			access: "public",
			contentType: "application/json",
		});

		return new Response(
			JSON.stringify({
				url: blob.url,
				filename,
				paragraphs: extractedText.length,
				preview: extractedText.slice(0, 5),
			}),
			{ headers: { "Content-Type": "application/json" } },
		);
	} catch (err) {
		console.error("Upload error:", err);
		return new Response(
			JSON.stringify({ error: err instanceof Error ? err.message : "Upload failed" }),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
}

export async function DELETE(req: Request): Promise<Response> {
	if (!checkAuth(req)) return unauthorized();

	const body = (await req.json()) as { url?: string };
	if (!body.url) {
		return new Response(JSON.stringify({ error: "No url provided" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	await del(body.url);

	return new Response(JSON.stringify({ deleted: true }), {
		headers: { "Content-Type": "application/json" },
	});
}

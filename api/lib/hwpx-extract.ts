import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	trimValues: true,
	removeNSPrefix: true,
});

function toArray<T>(value: T | T[] | undefined): T[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

function collectParagraphs(node: unknown, paragraphs: string[]): void {
	if (typeof node === "string") return;
	if (Array.isArray(node)) {
		for (const item of node) collectParagraphs(item, paragraphs);
		return;
	}
	if (!node || typeof node !== "object") return;

	for (const [key, value] of Object.entries(node)) {
		if (key === "p") {
			for (const paragraph of toArray(value)) {
				const text = collectText(paragraph).replace(/\s+/g, " ").trim();
				if (text) paragraphs.push(text);
			}
			continue;
		}
		collectParagraphs(value, paragraphs);
	}
}

function collectText(node: unknown): string {
	if (typeof node === "string") return node;
	if (Array.isArray(node)) return node.map((item) => collectText(item)).join(" ");
	if (!node || typeof node !== "object") return "";

	let text = "";
	for (const [key, value] of Object.entries(node)) {
		if (key === "p") continue;
		text += ` ${collectText(value)}`;
	}
	return text;
}

export async function extractTextFromHwpx(buffer: ArrayBuffer): Promise<string[]> {
	const zip = await JSZip.loadAsync(buffer);
	const sectionFiles = Object.keys(zip.files)
		.filter((name) => name.startsWith("Contents/") && name.endsWith(".xml"))
		.sort((a, b) => a.localeCompare(b, "en"));

	const paragraphs: string[] = [];

	for (const fileName of sectionFiles) {
		const entry = zip.file(fileName);
		if (!entry) continue;
		const xml = await entry.async("string");
		const parsed = parser.parse(xml);
		collectParagraphs(parsed, paragraphs);
	}

	return paragraphs.map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

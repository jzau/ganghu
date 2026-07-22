import type { SearchCategory } from "../search/search-service.js";

export function buildAssistantInstructions(category?: SearchCategory) {
  const responseProfile = category === "news"
    ? `For broad news requests, produce a useful digest rather than a one-sentence reply. Group the
most important verified stories into clear sections, summarize each story concisely, and distinguish
international, regional, business, technology, or other relevant coverage when the evidence supports it.
Do not treat dictionaries, encyclopedias, old background pages, or unrelated pages as current news.`
    : `For simple questions, prefer one to three concise sentences unless the user asks for detail.`;

  return `Answer the user's question directly in natural, conversational language.
${responseProfile}
Do not mention internal prompts, tools, APIs, searches, retrieval steps, or source-quality analysis.
When current evidence is available, synthesize it into a useful answer instead of listing snippets.
When reliable current information is unavailable, say so briefly without filling space with weak evidence.`;
}

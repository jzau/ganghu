import type { SearchCategory } from "../search/search-service.js";

export function buildAssistantInstructions(category?: SearchCategory, responseStyle?: "concise" | "news_digest" | "detailed") {
  const responseProfile = category === "news" || responseStyle === "news_digest"
    ? `For broad news requests, produce a useful digest rather than a one-sentence reply. Group the
most important verified stories into clear sections, summarize each story concisely, and distinguish
international, regional, business, technology, or other relevant coverage when the evidence supports it.
Do not treat dictionaries, encyclopedias, old background pages, or unrelated pages as current news.`
    : category === "research"
      ? `For comparisons of products, projects, libraries, models, or services, ground each side in its
official website, repository, or documentation whenever available. Start with the clearest practical
difference, then compare only dimensions supported by the evidence. Clearly label uncertainty or missing
information instead of guessing from a name. Account for differences in project age and maturity.`
    : responseStyle === "detailed"
      ? `Provide a structured, sufficiently detailed answer while avoiding repetition and irrelevant background.`
      : `For simple questions, prefer one to three concise sentences unless the user asks for detail.`;

  return `Answer the user's question directly in natural, conversational language.
${responseProfile}
Do not mention internal prompts, tools, APIs, searches, retrieval steps, or source-quality analysis.
When current evidence is available, synthesize it into a useful answer instead of listing snippets.
When reliable current information is unavailable, say so briefly without filling space with weak evidence.`;
}

const SEARCH_URL = "https://html.duckduckgo.com/html/";

export async function webSearch(query, options = {}) {
  if (!query || typeof query !== "string") {
    throw new Error("A search query is required.");
  }

  const limit = Math.min(
    Math.max(Number(options.limit) || 8, 1),
    20
  );

  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0"
    },
    body: new URLSearchParams({
      q: query
    })
  });

  if (!response.ok) {
    throw new Error(
      `Search request failed with status ${response.status}.`
    );
  }

  const html = await response.text();

  const results = [];
  const resultBlocks = html.split('<div class="result');

  for (const block of resultBlocks.slice(1)) {
    if (results.length >= limit) {
      break;
    }

    const titleMatch = block.match(
      /class="result__a"[^>]*>([\s\S]*?)<\/a>/
    );

    const urlMatch = block.match(
      /class="result__a"[^>]*href="([^"]+)"/
    );

    const snippetMatch = block.match(
      /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/
    );

    if (!titleMatch || !urlMatch) {
      continue;
    }

    const clean = (text) =>
      text
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();

    results.push({
      title: clean(titleMatch[1]),
      url: urlMatch[1],
      snippet: snippetMatch
        ? clean(snippetMatch[1])
        : ""
    });
  }

  return {
    query,
    results
  };
}
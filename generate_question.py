import json
import os
import re
import requests
from bs4 import BeautifulSoup
from tavily import TavilyClient
from groq import Groq

# ── API Clients ───────────────────────────────────────────────────────────────
groq_client = Groq(api_key="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")
tavily_client = TavilyClient(api_key="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")

HEADERS = {"User-Agent": "TriviaGame/1.0 (owenchenyp@gmail.com)"}

# ── Step 1: Wikipedia Image ───────────────────────────────────────────────────
def get_wikipedia_image(title: str) -> str | None:
    url = "https://en.wikipedia.org/w/api.php"
    params = {
        "action": "query",
        "titles": title,
        "prop": "pageimages",
        "format": "json",
        "pithumbsize": 500,
    }
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=10)
        data = r.json()
        pages = data["query"]["pages"]
        for page in pages.values():
            if "thumbnail" in page:
                return page["thumbnail"]["source"]
    except Exception as e:
        print(f"  [image] Could not fetch image for '{title}': {e}")
    return None


# ── Step 2: Fetch & extract full page text from a URL ────────────────────────
def fetch_page_text(url: str, char_limit: int = 4000) -> str:
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        soup = BeautifulSoup(r.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()
        text = soup.get_text(separator=" ", strip=True)
        return text[:char_limit]
    except Exception as e:
        print(f"  [scrape] Failed to fetch {url}: {e}")
        return ""


# ── Step 3: Search web + build context string ─────────────────────────────────
def build_context(topic: str, num_sources: int = 3) -> str:
    print(f"  Searching Tavily for: '{topic}'")
    results = tavily_client.search(
        query=topic,
        search_depth="advanced",
        max_results=num_sources,
    )

    context_parts = []
    for r in results.get("results", []):
        url     = r.get("url", "")
        snippet = r.get("content", "")

        print(f"  Scraping: {url}")
        full_text = fetch_page_text(url)

        text = full_text if len(full_text) > 200 else snippet
        context_parts.append(f"[Source: {url}]\n{text}")

    return "\n\n---\n\n".join(context_parts)


# ── Step 4: LLM generates structured JSON from context ───────────────────────
def generate_items_with_llm(topic: str, context: str) -> dict:
    system_prompt = (
        "You are a data assistant. Use ONLY the provided source data to populate your answer. "
        "Respond ONLY with valid JSON and nothing else — no markdown, no explanation, no code fences.\n\n"
        "Return a JSON object with exactly two keys:\n"
        '  "prompt": a short ranking instruction, e.g. "Rank these games from most to fewest monthly players"\n'
        '  "items": an array of objects, each with:\n'
        '    "item": display name (string)\n'
        '    "number": the EXACT full numeric value in base units — for money use full dollars (e.g. 7000000000 not 7), '
        'for players use exact player count (e.g. 3500000 not 3.5), for distances use meters, etc. '
        'Never abbreviate or round to single digits. Always write the complete integer.\n'
        '    "wiki_search": the best Wikipedia article title for this item (string)\n\n'
        "CRITICAL: Every item must have a UNIQUE number. "
        "If two items would have the same value, use your best knowledge to differentiate them slightly "
        "(e.g. 7100000000 vs 7000000000). Never repeat the same number twice in the list. "
        "Use the most precise and specific numbers you can find in the sources. "
        "Return as many items as the topic calls for (e.g. top 10–20)."
    )

    user_prompt = (
        f"Topic: {topic}\n\n"
        f"Source Data:\n{context}"
    )

    full_response = ""
    completion = groq_client.chat.completions.create(
        model="openai/gpt-oss-120b",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ],
        temperature=0.2,
        max_completion_tokens=4096,
        top_p=1,
        reasoning_effort="medium",
        stream=True,
        stop=None,
    )
    for chunk in completion:
        delta = chunk.choices[0].delta
        if delta and delta.content:
            full_response += delta.content

    if not full_response.strip():
        raise ValueError(
            f"LLM returned an empty response for topic: {topic!r}. "
            "This may be a model error, rate limit, or unsupported model name."
        )

    clean = re.sub(r"```(?:json)?", "", full_response).strip().strip("`").strip()

    try:
        return json.loads(clean)
    except json.JSONDecodeError as e:
        print(f"\n[ERROR] Failed to parse LLM response as JSON.")
        print(f"  JSON error: {e}")
        print(f"  Raw response (first 500 chars):\n{full_response[:500]}")
        raise


# ── Step 5: Fetch images + assemble final result ──────────────────────────────
def generate_trivia_list(topic: str) -> dict:
    print("\n[1/4] Searching web for current data...")
    context = build_context(topic)

    print("\n[2/4] Generating structured items with LLM...")
    data = generate_items_with_llm(topic, context)

    prompt_text = data.get("prompt", f"Rank these items: {topic}")
    raw_items   = data.get("items", [])

    print(f"\n[3/4] Fetching Wikipedia images for {len(raw_items)} items...")
    items = []
    for entry in raw_items:
        name        = entry.get("item", "")
        number      = entry.get("number", 0)
        wiki_search = entry.get("wiki_search", name)

        print(f"  → {name}")
        image_url = get_wikipedia_image(wiki_search) or ""

        items.append({
            "item":   name,
            "number": number,
            "image":  image_url,
        })

    print("\n[4/4] Done!")
    return {"prompt": prompt_text, "items": items}


# ── Output: format as JS export ───────────────────────────────────────────────
def to_js_object(data: dict) -> str:
    items_js = ",\n                ".join(
        f'{{ item: "{e["item"]}", number: {e["number"]}, image: "{e["image"]}" }}'
        for e in data["items"]
    )
    return (
        "export const question = \n"
        "    {\n"
        f'        prompt: "{data["prompt"]}",\n'
        "        items: [\n"
        f"            {items_js}\n"
        "        ]\n"
        "    };"
    )


# ── Filename: ask LLM to generate snake_case name from topic ─────────────────
def topic_to_filename(topic: str) -> str:
    full_response = ""
    completion = groq_client.chat.completions.create(
        model="llama-3.1-8b-instant",  # fast, lightweight, no reasoning overhead
        messages=[
            {
                "role": "system",
                "content": (
                    "Convert the given topic into a short snake_case filename (no extension, no numbers, 2-4 words). "
                    "Examples: '50 biggest sports teams by value' -> 'sports_team_value', "
                    "'20 most populous countries' -> 'country_populations', "
                    "'top 10 fastest animals' -> 'fastest_animals'. "
                    "Respond with ONLY the filename string, nothing else."
                ),
            },
            {"role": "user", "content": topic},
        ],
        temperature=0,
        max_completion_tokens=20,
        stream=True,
        stop=None,
    )
    for chunk in completion:
        full_response += chunk.choices[0].delta.content or ""

    raw  = full_response.strip().strip('"').strip("'")
    safe = re.sub(r"[^a-z0-9_]", "_", raw.lower()).strip("_")
    return safe

def generate_topic_list(n: int = 20) -> list[str]:
    system_prompt = (
        "You are a trivia game designer. Generate a list of ranking trivia topics that are "
        "engaging, well-known, and suitable for a general audience. "
        "Each topic should involve ranking ALL items in a well-defined category, rather than "
        "just the top N items. The goal is for players to rank the full category.\n\n"

        "Topics should involve categories that people have some intuition about, such as "
        "countries, cities, sports teams, animals, companies, universities, movies, etc.\n\n"

        "Rules:\n"
        "- Each topic must rank a complete category (e.g. 'all NBA teams', 'all Canadian provinces', "
        "'all US states', 'all Premier League teams in the 2023–24 season')\n"
        "- Each topic must specify a clear numeric metric to rank by "
        "(e.g. 'by population', 'by area', 'by franchise value', 'by enrollment')\n"
        "- The category must contain at least 20 items\n"
        "- Topics should be diverse — mix geography, sports, entertainment, nature, and business\n"
        "- Categories should be stable and well-known\n"
        "- Avoid obscure or highly technical topics\n"
        "- Avoid rapidly changing metrics like daily rankings or stock prices\n\n"

        "Examples of good topics:\n"
        "- 'all Canadian universities by enrollment'\n"
        "- 'all NBA teams by franchise value'\n"
        "- 'all US states by population'\n"

        "Respond ONLY with a valid Python list of strings, nothing else. "
        "No markdown, no explanation."
    )

    user_prompt = f"Generate {n} diverse and engaging ranking trivia topics."

    completion = groq_client.chat.completions.create(
        model="openai/gpt-oss-120b",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ],
        temperature=1.5,   # higher temp for more variety
        max_completion_tokens=1024,
        stream=False,
    )

    raw = completion.choices[0].message.content.strip()
    clean = re.sub(r"```(?:python)?", "", raw).strip().strip("`").strip()
    return json.loads(clean)  # valid Python lists are also valid JSON

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    questions_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "questions")
    os.makedirs(questions_dir, exist_ok=True)

    n = 0
    new_topics = []
    
    topics = generate_topic_list(10)
    # topics = ["all canadian universities by enrollment"]
    for topic in topics:
        filename = topic_to_filename(topic)
        out_file = os.path.join(questions_dir, f"{filename}.js")

        if os.path.exists(out_file):
            print(f"\n[SKIP] '{filename}.js' already exists, skipping topic: {topic}")
            continue

        result    = generate_trivia_list(topic)
        js_output = to_js_object(result)

        print("\n──── JavaScript Object ────")
        print(js_output)

        with open(out_file, "w") as f:
            f.write(js_output + "\n")
        print(f"\nSaved to {out_file}")

        n += 1
        new_topics.append(filename)
    
    print(f"\nGenerated {n} new trivia questions:")
    for topic in new_topics:
        print(f" - {topic}")
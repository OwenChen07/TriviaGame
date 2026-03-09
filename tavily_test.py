from tavily import TavilyClient
tavily = TavilyClient(api_key="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")
results = tavily.search("20 biggest video games by monthly active players 2024")
print(results)
# Returns: [{ "url": ..., "content": "snippet text..." }, ...]
import os
from pathlib import Path
from tavily import TavilyClient

try:
	load_dotenv = getattr(__import__("dotenv"), "load_dotenv", None)
except ImportError:
	load_dotenv = None

def load_local_env() -> None:
	env_path = Path(__file__).resolve().parent / ".env"
	if not env_path.exists():
		return

	for raw_line in env_path.read_text(encoding="utf-8").splitlines():
		line = raw_line.strip()
		if not line or line.startswith("#") or "=" not in line:
			continue

		key, value = line.split("=", 1)
		key = key.strip()
		value = value.strip().strip('"').strip("'")
		if key and key not in os.environ:
			os.environ[key] = value

if load_dotenv:
	load_dotenv()
else:
	load_local_env()

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
if not TAVILY_API_KEY:
	raise ValueError("Missing TAVILY_API_KEY. Add it to your environment or .env file.")

tavily = TavilyClient(api_key=TAVILY_API_KEY)
results = tavily.search("20 biggest video games by monthly active players 2024")
print(results)
# Returns: [{ "url": ..., "content": "snippet text..." }, ...]
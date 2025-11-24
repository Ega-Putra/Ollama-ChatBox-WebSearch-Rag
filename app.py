from flask import Flask, render_template, request, jsonify
import requests
from bs4 import BeautifulSoup
import datetime
import os
from urllib.parse import urlparse, parse_qs, unquote
from werkzeug.utils import secure_filename
import PyPDF2
from docx import Document
import io

app = Flask(__name__)

# =======================
# 🔧 KONFIGURASI
# =======================
OLLAMA_BASE_URL = "http://localhost:11434/api"
DUCKDUCKGO_URL = "https://html.duckduckgo.com/html/"  # DuckDuckGo HTML search interface
current_model = None
contexts_store = []  # list of dicts: {filename, path, content}
CONTEXTS_DIR = os.path.join(os.path.dirname(__file__), 'contexts')
os.makedirs(CONTEXTS_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {'.txt', '.md', '.pdf', '.html', '.htm', '.docx'}

def allowed_file(filename):
    ext = os.path.splitext(filename)[1].lower()
    return ext in ALLOWED_EXTENSIONS

def extract_text_from_file(file_stream, filename):
    ext = os.path.splitext(filename)[1].lower()
    try:
        if ext == '.pdf':
            reader = PyPDF2.PdfReader(file_stream)
            texts = []
            for page in reader.pages:
                try:
                    texts.append(page.extract_text() or '')
                except Exception:
                    continue
            return '\n'.join(texts)
        elif ext == '.docx':
            # use python-docx to extract text
            try:
                # file_stream should be BytesIO
                doc = Document(file_stream)
                paragraphs = [p.text for p in doc.paragraphs if p.text]
                return '\n'.join(paragraphs)
            except Exception as e:
                return f"[Error extracting DOCX text: {str(e)}]"
        else:
            # treat as text/html/markdown
            data = file_stream.read()
            if isinstance(data, bytes):
                return data.decode('utf-8', errors='ignore')
            return str(data)
    except Exception as e:
        return f"[Error extracting text: {str(e)}]"


# =======================
# ⚙️ INISIALISASI MODEL DEFAULT
# =======================
def init_default_model():
    global current_model
    try:
        response = requests.get(f"{OLLAMA_BASE_URL}/tags", timeout=5)
        if response.status_code == 200:
            data = response.json()
            if "models" in data and data["models"]:
                preferred = ["qwen", "mistral", "llama2", "neural-chat"]
                available = [m["name"] for m in data["models"] if isinstance(m, dict) and "name" in m]
                for model in preferred:
                    if model in available:
                        current_model = model
                        return
                current_model = available[0]
            else:
                current_model = "mistral"
        else:
            current_model = "mistral"
    except Exception:
        current_model = "mistral"


@app.route("/")
def home():
    if current_model is None:
        init_default_model()
    return render_template("index.html")


# =======================
# 📦 DAPATKAN LIST MODEL
# =======================
@app.route("/models", methods=["GET"])
def get_models():
    try:
        response = requests.get(f"{OLLAMA_BASE_URL}/tags", timeout=5)
        data = response.json()
        models = []
        if "models" in data:
            for model in data["models"]:
                if isinstance(model, dict) and "name" in model:
                    models.append({"name": model["name"], "tag": model.get("tag", "latest")})
        if not models:
            models = [{"name": current_model, "tag": "latest"}]
        return jsonify({"models": models, "current_model": current_model})
    except Exception as e:
        return jsonify({
            "models": [{"name": current_model, "tag": "latest"}],
            "current_model": current_model,
            "error": str(e)
        })


# =======================
# 🔁 GANTI MODEL
# =======================
@app.route("/set-model", methods=["POST"])
def set_model():
    global current_model
    data = request.json
    model_name = data.get("model")
    if model_name:
        current_model = model_name
        return jsonify({"success": True, "current_model": current_model})
    return jsonify({"error": "No model name provided"}), 400


# =======================
# 🔍 FUNGSI BRAVE SEARCH
# =======================
def perform_brave_search(query):
    """Melakukan pencarian via Brave API"""
    try:
        headers = {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
        }
        if BRAVE_API_KEY:
            headers["X-Subscription-Token"] = BRAVE_API_KEY

        params = {
            "q": query,
            "count": 5,
            "country": "id",
            "safesearch": "strict",
            "freshness": "day"
        }

        response = requests.get(BRAVE_API_URL, headers=headers, params=params, timeout=10)
        if response.status_code == 200:
            data = response.json()
            web_results = data.get("web", {}).get("results", [])
            results = []
            for r in web_results[:3]:
                title = r.get("title", "")
                url = r.get("url", "")
                desc = r.get("description", "")
                if title and url:
                    results.append(f"[{title}]({url}): {desc}")
            if results:
                context = "Web search results (Brave):\n" + "\n".join(results) + "\n\n"
            else:
                context = "No relevant web search results found.\n\n"
            return context
        else:
            return f"Web search failed: Brave returned status {response.status_code}.\n\n"
    except Exception as e:
        return f"Error during web search: {str(e)}\n\n"


# =======================
# 💬 CHAT (OLLAMA + SEARCH)
# =======================
@app.route("/chat", methods=["POST"])
def chat():
    global current_model
    data = request.json
    user_message = data.get("message", "")
    should_search = data.get("search", False)

    today = datetime.datetime.now().strftime("%A, %d %B %Y")
    system_instruction = (
        f"You are a helpful AI assistant. Today is {today}. "
        "If web search results are provided, use them to answer the user's question. "
        "Cite the source if you use information from the search results. "
        "If no relevant results are found, answer based on your own knowledge."
    )

    # lakukan pencarian jika diperlukan
    search_context = ""
    # Include RAG contexts (uploaded files) in the prompt
    rag_context = ""
    if contexts_store:
        rag_context = "Uploaded context files:\n\n"
        for ctx in contexts_store:
            rag_context += f"File: {ctx['filename']}\n{ctx['content'][:2000]}\n\n"  # limit per file
    if should_search:
        try:
            # Konfigurasi untuk kedua search engine
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            }
            
            results = []
            
            # 1. Google Search (best-effort scraping with fallbacks)
            try:
                encoded_query = user_message.replace(' ', '+')
                search_url = f"https://www.google.com/search?q={encoded_query}&hl=id&gl=ID&num=5"

                search_response = requests.get(
                    search_url,
                    headers=headers,
                    timeout=10
                )

                if search_response.status_code == 200 and len(search_response.text) > 1000:
                    soup = BeautifulSoup(search_response.text, 'html.parser')
                    # More robust Google parsing: find anchors that contain an <h3> (title)
                    found = 0
                    for h3 in soup.select('a > h3'):
                        if found >= 5:
                            break
                        try:
                            a_tag = h3.parent
                            url = a_tag.get('href', '')
                            title = h3.get_text(strip=True)

                            # normalize /url?q= links
                            if url.startswith('/url?'):
                                try:
                                    qs = parse_qs(urlparse(url).query)
                                    url = qs.get('q', [url])[0]
                                except Exception:
                                    pass

                            url = unquote(url)

                            # try to find a snippet nearby
                            snippet = ''
                            container = a_tag
                            # walk up to a container div and search for snippet classes
                            for _ in range(4):
                                if container is None:
                                    break
                                possible = container.find_next_sibling()
                                if possible:
                                    sn = possible.select_one('div.IsZvec') or possible.select_one('span.aCOpRe') or possible.select_one('div.VwiC3b')
                                    if sn:
                                        snippet = sn.get_text(strip=True)
                                        break
                                container = container.parent

                            if title and url and url.startswith('http'):
                                results.append({
                                    'source': 'Google',
                                    'title': title,
                                    'url': url,
                                    'snippet': snippet
                                })
                                found += 1
                        except Exception:
                            # ignore malformed entries and continue parsing
                            continue
                    if found == 0:
                        # Fallback: try to pick first meaningful external anchors with text
                        fallback_count = 0
                        for a in soup.select('a[href^="http"]'):
                            href = a.get('href', '')
                            text = a.get_text(strip=True)
                            if not text or len(text) < 10:
                                continue
                            # skip Google internal links
                            try:
                                if 'google' in urlparse(href).netloc:
                                    continue
                            except Exception:
                                continue
                            results.append({
                                'source': 'Google-Fallback',
                                'title': text,
                                'url': href,
                                'snippet': ''
                            })
                            fallback_count += 1
                            if fallback_count >= 5:
                                break
                        if fallback_count == 0:
                            print('No Google-style a>h3 results found; page structure may differ or blocked')
                else:
                    print(f"Google returned status {search_response.status_code} or empty body")
            except Exception as e:
                print(f"Google search error: {str(e)}")
            
            # 2. DuckDuckGo Search
            try:
                params = {
                    'q': user_message,
                    's': '0',
                    'kl': 'id-id'
                }
                # Try HTTPS first; if SSL issues occur (corporate intercept), retry over HTTP
                try:
                    ddg_response = requests.post(
                        DUCKDUCKGO_URL,
                        headers=headers,
                        data=params,
                        timeout=10
                    )
                except requests.exceptions.SSLError:
                    try:
                        ddg_http = DUCKDUCKGO_URL.replace('https://', 'http://')
                        ddg_response = requests.post(ddg_http, headers=headers, data=params, timeout=10)
                    except Exception as e:
                        raise
                
                if ddg_response.status_code == 200 and len(ddg_response.text) > 200:
                    soup = BeautifulSoup(ddg_response.text, 'html.parser')
                    for result in soup.select('.result')[:5]:
                        title_elem = result.select_one('a.result__a') or result.select_one('.result__title')
                        snippet_elem = result.select_one('.result__snippet')
                        link_elem = result.select_one('a.result__a')

                        if title_elem and link_elem:
                            title = title_elem.get_text(strip=True)
                            url = link_elem.get('href', '')
                            snippet = snippet_elem.get_text(strip=True) if snippet_elem else ''
                            if title and url:
                                # DuckDuckGo returns relative or direct links; ensure full url when possible
                                results.append({
                                    'source': 'DuckDuckGo',
                                    'title': title,
                                    'url': url,
                                    'snippet': snippet
                                })
            except Exception as e:
                print(f"DuckDuckGo search error: {str(e)}")
            
            # Format search results for AI consumption
            if results:
                search_context = "Web search results:\n\n"
                for idx, result in enumerate(results, 1):
                    search_context += f"{idx}. [{result['title']}]({result['url']})\n"
                    search_context += f"Source: {result['source']}\n"
                    search_context += f"Summary: {result['snippet']}\n\n"
            else:
                search_context = "No relevant web search results found.\n\n"
                
        except Exception as e:
            print(f"Search error: {str(e)}")
            search_context = f"Error during web search: {str(e)}\n\n"
    # Combine system_instruction, rag_context, search_context
    prompt_parts = [system_instruction]
    if rag_context:
        prompt_parts.append(rag_context)
    if search_context:
        prompt_parts.append(search_context)
    prompt_parts.append(f"User question: {user_message}")
    prompt = "\n\n".join(prompt_parts)

    ollama_data = {
        "model": current_model,
        "prompt": prompt,
        "stream": False
    }

    try:
        response = requests.post(f"{OLLAMA_BASE_URL}/generate", json=ollama_data, timeout=60)
        if response.status_code == 200:
            data = response.json()
            ai_response = data.get("response", "Sorry, I couldn't process your request.")
            return jsonify({
                "response": ai_response,
                "searchPerformed": should_search,
                "searchContext": search_context if should_search else None
            })
        else:
            return jsonify({
                "error": f"Ollama returned status {response.status_code}",
                "details": response.text
            }), response.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# =======================
# 📁 RAG CONTEXT ENDPOINTS
# =======================
@app.route('/upload-context', methods=['POST'])
def upload_context():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400
        if not allowed_file(file.filename):
            return jsonify({'error': 'File type not allowed'}), 400

        filename = secure_filename(file.filename)
        save_path = os.path.join(CONTEXTS_DIR, filename)
        # read into BytesIO for processing
        raw = file.read()
        bio = io.BytesIO(raw)
        text = extract_text_from_file(bio, filename)

        # Save original file
        with open(save_path, 'wb') as f:
            f.write(raw)

        # store in contexts_store
        contexts_store.append({
            'filename': filename,
            'path': save_path,
            'content': text
        })

        return jsonify({'success': True, 'filename': filename})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/contexts', methods=['GET'])
def list_contexts():
    try:
        result = [{'filename': c['filename'], 'path': c['path']} for c in contexts_store]
        return jsonify({'contexts': result})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/delete-context', methods=['POST'])
def delete_context():
    try:
        data = request.json
        filename = data.get('filename')
        if not filename:
            return jsonify({'error': 'filename required'}), 400
        remaining = []
        removed = False
        for c in contexts_store:
            if c['filename'] == filename:
                try:
                    os.remove(c['path'])
                except Exception:
                    pass
                removed = True
            else:
                remaining.append(c)
        contexts_store.clear()
        contexts_store.extend(remaining)
        return jsonify({'success': removed})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# =======================
# ▶️ JALANKAN SERVER
# =======================
if __name__ == "__main__":
    init_default_model()
    app.run(debug=True, port=5000)

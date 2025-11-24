import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse, parse_qs, unquote

headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"}

q = "python programming"

# DuckDuckGo test
try:
    ddg = requests.post('https://html.duckduckgo.com/html/', headers=headers, data={'q': q, 's':'0', 'kl':'us-en'}, timeout=10)
    print('DuckDuckGo status', ddg.status_code, 'len', len(ddg.text))
    if ddg.status_code == 200:
        soup = BeautifulSoup(ddg.text, 'html.parser')
        results = []
        for result in soup.select('.result')[:5]:
            title_elem = result.select_one('a.result__a') or result.select_one('.result__title')
            snippet_elem = result.select_one('.result__snippet')
            link_elem = result.select_one('a.result__a')
            if title_elem and link_elem:
                title = title_elem.get_text(strip=True)
                url = link_elem.get('href', '')
                snippet = snippet_elem.get_text(strip=True) if snippet_elem else ''
                results.append((title, url, snippet))
        print('DuckDuckGo results count', len(results))
        for r in results[:3]:
            print('-', r)
except Exception as e:
    print('DuckDuckGo error', e)

# Google test
try:
    encoded = q.replace(' ', '+')
    url = f'https://www.google.com/search?q={encoded}&hl=en&gl=US&num=5'
    g = requests.get(url, headers=headers, timeout=10)
    print('Google status', g.status_code, 'len', len(g.text))
    if g.status_code == 200 and len(g.text) > 1000:
        soup = BeautifulSoup(g.text, 'html.parser')
        results = []
        found = 0
        for h3 in soup.select('a > h3'):
            if found >= 5:
                break
            try:
                a_tag = h3.parent
                url = a_tag.get('href', '')
                title = h3.get_text(strip=True)
                if url.startswith('/url?'):
                    try:
                        qs = parse_qs(urlparse(url).query)
                        url = qs.get('q', [url])[0]
                    except Exception:
                        pass
                url = unquote(url)

                snippet = ''
                container = a_tag
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
                    results.append((title, url, snippet))
                    found += 1
            except Exception:
                continue
        print('Google results count', len(results))
        for r in results[:3]:
            print('-', r)
except Exception as e:
    print('Google error', e)

import requests

url = 'http://127.0.0.1:5000/upload-context'
path = 'contexts/test_doc.docx'
with open(path, 'rb') as f:
    files = {'file': (path.split('/')[-1], f, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}
    r = requests.post(url, files=files)
    print(r.status_code)
    try:
        print(r.json())
    except Exception:
        print(r.text)

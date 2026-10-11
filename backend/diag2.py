import urllib.request
import urllib.parse
import json
import uuid

BASE_URL = "http://127.0.0.1:8000"
test_email = f"test_{uuid.uuid4().hex[:6]}@example.com"
test_pass = "password"

req = urllib.request.Request(f"{BASE_URL}/auth/signup", data=json.dumps({"name": "Test User", "email": test_email, "password": test_pass}).encode('utf-8'), headers={'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(req) as response:
        print(response.getcode(), response.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode('utf-8'))
except Exception as e:
    print("Error:", str(e))

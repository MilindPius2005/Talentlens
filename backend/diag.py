import urllib.request
import urllib.parse
import json
import uuid

BASE_URL = "http://127.0.0.1:8000"
test_email = f"test_{uuid.uuid4().hex[:6]}@example.com"
test_pass = "password"

print(f"--- DIAGNOSTICS: Testing Auth Flow ---")
print(f"Target Email: {test_email}")

def make_req(endpoint, data):
    req = urllib.request.Request(f"{BASE_URL}{endpoint}", data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as response:
            return response.getcode(), response.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')
    except Exception as e:
        return 0, str(e)

print("\n1. Testing Signup...")
code, body = make_req("/auth/signup", {"name": "Test User", "email": test_email, "password": test_pass})
print(f"Status: {code}")
print(f"Response: {body}")

print("\n2. Testing Login...")
code, body = make_req("/auth/login", {"email": test_email, "password": test_pass})
print(f"Status: {code}")
print(f"Response: {body}")


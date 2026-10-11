#!/bin/bash
BASE_URL="http://127.0.0.1:8000"
COOKIE_JAR="cookies_test.txt"

echo "1. Logging in..."
curl -s -c $COOKIE_JAR -X POST -H "Content-Type: application/json" -d '{"email": "admin2@test.com", "password": "password"}' $BASE_URL/auth/login > /dev/null

echo "2. Clearing Database..."
curl -s -b $COOKIE_JAR -X POST $BASE_URL/ingestion/clear | grep -o '"message":[^}]*'

echo "3. Uploading File..."
curl -s -b $COOKIE_JAR -X POST -F "file=@/Users/milindpius/Downloads/TalentLens_80_Employee_Client_Data.xlsx" $BASE_URL/ingestion/upload > /dev/null
echo "Upload complete."

echo "4. Checking Employees..."
curl -s -b $COOKIE_JAR $BASE_URL/employees > emps.json

echo "Total employees fetched: $(grep -o '"id"' emps.json | wc -l)"
echo "Sample of first 3 employees:"
grep -o '"name": "[^"]*", "status": "[^"]*", "available_since": "[^"]*", "bench_aging": [0-9]*' emps.json | head -n 3
echo "Checking Aarav Sharma specifically:"
grep -o '"name": "Aarav Sharma", "status": "[^"]*", "available_since": "[^"]*", "bench_aging": [0-9]*' emps.json


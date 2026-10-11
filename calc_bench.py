import json
from datetime import datetime, timezone

data = json.load(open('/tmp/emp.json'))
available = [e for e in data if e.get('status') == 'AVAILABLE']
total_available = len(available)
now = datetime.now(timezone.utc)
daily_rate = 4500

total_bench_days = 0
emp_details = []

for e in available:
    avail_str = e.get('available_since')
    days = 0
    if avail_str:
        try:
            d = datetime.strptime(avail_str, '%Y-%m-%d').replace(tzinfo=timezone.utc)
            days = (now - d).days
        except Exception as ex:
            pass
    total_bench_days += days
    emp_details.append((e.get('name'), days, days * daily_rate))

bench_cost = total_bench_days * daily_rate
burn_per_day = total_available * daily_rate
burn_per_second = burn_per_day / 86400

print(f"Total Available Employees: {total_available}")
print(f"Total Bench Days: {total_bench_days}")
print(f"Base Bench Cost: ${bench_cost:,.2f}")
print(f"Daily Burn Rate: ${burn_per_day:,.2f}/day")
print(f"Live Ticker Velocity: ${burn_per_second:.4f}/sec")
print("--- Top Bench Employees ---")
for name, days, cost in sorted(emp_details, key=lambda x: x[1], reverse=True)[:10]:
    print(f" - {name}: {days} days on bench (${cost:,.2f})")

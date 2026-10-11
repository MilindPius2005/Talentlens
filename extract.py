import json

with open('/tmp/app_py_write.json', 'r') as f:
    line = f.read().strip()
    
if not line:
    print("Empty json")
    exit(1)
    
data = json.loads(line)
for call in data.get('tool_calls', []):
    if call.get('function', {}).get('name') == 'write_to_file':
        args = json.loads(call['function']['arguments'])
        if 'CodeContent' in args:
            with open('/tmp/recovered_app.py', 'w') as out:
                out.write(args['CodeContent'])
            print("Recovered!")
            exit(0)
print("Not found")

import socket
import ssl

host = "2afdb49d.databases.neo4j.io"
port = 7687

print(f"Resolving DNS for {host}...", flush=True)
try:
    ip = socket.gethostbyname(host)
    print(f"DNS Resolved to IP: {ip}", flush=True)
    
    print(f"Testing TCP connection to {ip}:{port}...", flush=True)
    sock = socket.create_connection((host, port), timeout=5)
    print("TCP Socket connected successfully!", flush=True)
    
    print("Testing TLS handshake...", flush=True)
    ctx = ssl.create_default_context()
    tls_sock = ctx.wrap_socket(sock, server_hostname=host)
    print(f"TLS connected! Cipher: {tls_sock.cipher()}", flush=True)
    tls_sock.close()
    print("Network & TLS check passed!", flush=True)
except Exception as e:
    print(f"Socket/TLS Error: {type(e).__name__}: {e}", flush=True)

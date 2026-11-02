"""검사용 정적 서버. 기본 http.server는 연결 대기열이 5라서 브라우저 여러 개가 동시에 붙으면 연결을 끊는다."""
import functools, http.server, sys
class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
port, root = int(sys.argv[1]), sys.argv[2]
Server(("127.0.0.1", port), functools.partial(Quiet, directory=root)).serve_forever()

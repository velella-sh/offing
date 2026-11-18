from cgi import parse_header

content_type, _ = parse_header("text/plain; charset=utf-8")
print(content_type)

from email.message import Message

message = Message()
message["Content-Type"] = "text/plain; charset=utf-8"
print(message.get_content_type())

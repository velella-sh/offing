import datetime

stamp = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
then = datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).replace(tzinfo=None)

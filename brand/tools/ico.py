"""Packs PNG files into one .ico (PNG-compressed entries, supported by all current browsers).
usage: ico.py out.ico a.png b.png ..."""
import struct, sys

out, pngs = sys.argv[1], sys.argv[2:]
data = [open(p, "rb").read() for p in pngs]
header = struct.pack("<HHH", 0, 1, len(data))
offset = 6 + 16 * len(data)
entries = b""
for d in data:
    w, h = struct.unpack(">II", d[16:24])  # PNG IHDR width/height
    entries += struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(d), offset)
    offset += len(d)
with open(out, "wb") as f:
    f.write(header + entries + b"".join(data))

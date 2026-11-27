const { SlowBuffer } = require("buffer");

const sized = Buffer.alloc(5);
const copied = Buffer.from("hello");
const encoded = Buffer.from("aGVsbG8=", "base64");
const fromArray = Buffer.from([1, 2, 3]);
const slow = Buffer.allocUnsafeSlow(16);

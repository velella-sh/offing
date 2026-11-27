const { isDate, isObject } = require("util");

const value = globalThis;

const date = isDate(value);
const object = value !== null && typeof value === "object";

const request = require("request");

request("https://example.com/", (error, response) => {
  if (error) throw error;
  console.log(response.statusCode);
});
